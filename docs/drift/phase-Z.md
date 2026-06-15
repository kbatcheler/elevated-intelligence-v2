# Phase Z: proactive push intelligence

Phase id: Z. Name: Proactive Push Intelligence. Milestone: no. The second phase of the
owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC), which pauses at the Stage 4/5
boundary for owner review (before Phase AD); the next protocol MILESTONE hard stop is AI at
the end of Stage 5. Phase Z turns the persisted outcome loop into recorded, ranked,
deliverable notifications: a per-user in-app notification center, per-(user, tenant, kind)
rules a seat can tune and mute, and a scheduled Morning Brief digest delivered to a chosen
channel. It added zero npm dependencies and contains no em-dash or en-dash in source or in
data.

This is a deliberately SEPARATE seam from the Phase O/P operational alert seam
(`alert_events`). Those are connector and ops-health events for the provider-owner; these are
business-intelligence notifications for ANY seat, ranked by predicted dollar impact and
confidence, recorded once per breach, surfaced in an in-app center, and delivered as a
scheduled digest. New enums (`push_rule_type`, `push_channel`, `push_delivery_status`) are
declared on purpose rather than reusing the operational alert status, so the two lifecycles
can diverge without entangling.

## What was built

New schema (`lib/db/src/schema/pushIntelligence.ts`, two tables, three enums):

- `push_rules` is per-user, per-tenant, per-kind (`ownerUserId` NOT NULL; a unique constraint
  on `(ownerUserId, tenantId, type)`). Each rule carries `enabled`, a `mutedUntil` timestamp,
  optional `minImpactUsd` / `minConfidence` suppression floors (null means no floor, so every
  breach qualifies; the default rule opts into nothing), and a `channel`. A default rule is
  materialized lazily (enabled, no floor, in_app) for each tenant a user can reach, so a fresh
  seat has a tunable surface and the scheduled brief reaches everyone, not only those who have
  visited a page.
- `push_events` is one recorded notification, idempotent by `(ruleId, dedupeKey)`: the same
  breach in the same state produces the same key, so re-evaluation is a no-op rather than a
  duplicate, and a state change produces a new key and a new event. Owner and tenant are
  denormalized onto the row so the inbox is a single-table filter and the access check is
  belt-and-suspenders. Every figure (`impactUsd`, `confidence`, `rankScore`) is computed from
  persisted state or is null; `rankScore` is `impactUsd * (confidence / 100)`, zero when
  unquantified, so an event with no dollar figure ranks last and is suppressed, never promoted.
- `push_rule_type` is `outcome_shortfall` and `high_value_action` (the only two kinds
  implemented this phase; both computed entirely from already-persisted rows, never
  fabricated; more kinds are a later additive enum value, not a reinterpretation).
  `push_channel` is `in_app` (the always-available default), `slack`, and `email`.
  `push_delivery_status` is `pending`, `suppressed`, `sent`, `failed`.

The evaluator (`artifacts/api-server/src/lib/push/pushEvaluator.ts`), idempotent each pass:

- Materializes the default rule per reachable (user, tenant, kind) with ON CONFLICT DO
  NOTHING, then builds candidate breaches from real rows only. A `high_value_action` is an
  open committed action (`committed` or `in_progress`) carrying a parsed dollar prediction; an
  `outcome_shortfall` is the latest measurement of an action graded `missed` with a positive
  dollar shortfall against its prediction. A candidate with no dollar figure behind it is
  never invented.
- Scores each candidate under each enabled rule (`computeRankScore`, `evaluateSuppression`)
  and records a `pending` or `suppressed` event with ON CONFLICT (ruleId, dedupeKey) DO
  NOTHING. A disabled rule produces no events at all; a muted rule still evaluates but records
  suppressed events, so a mute hides noise without losing the record.

The drainer (`artifacts/api-server/src/lib/push/pushNotifier.ts`), mirroring the Phase P
alert notifier: claims pending rows with SELECT ... FOR UPDATE SKIP LOCKED, groups them per
(recipient, channel), delivers exactly one ranked digest per group, and flips every claimed
row to `sent` or `failed` exactly once, so a second tick or a second instance never re-sends a
row another drainer holds. The digest line cap is `PUSH_DIGEST_LIMIT` (default 10); the
overflow stays visible in the center, so a row never lingers pending forever. The channels:
`in_app` is a no-op that always succeeds (the row is already in the center), `slack` reuses
the operator `SLACK_WEBHOOK_URL`, and `email` is an available-not-connected adapter
(`EmailPushTransport`) that fails loudly and lazily with "set EMAIL_PUSH_ENDPOINT to connect
the email push channel" rather than silently dropping a notification.

The scheduled Morning Brief (`artifacts/api-server/src/lib/push/pushBrief.ts`,
`startPushMorningBrief`) runs the evaluation then the drain on a cadence
(`PUSH_MORNING_BRIEF_INTERVAL_MS`, default 12 hours). It is started ONLY from the server
entrypoint (`index.ts`), mirroring the retention, notifier, and backup loops: no overlap,
swallow a tick failure, unref'd timer.

The HTTP surface (`artifacts/api-server/src/routes/push.ts`, mounted at `/api/push` under the
shared `requireAuth` gate in `app.ts`): `GET /notifications` (the inbox),
`POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /rules`,
`PATCH /rules/:id` (tune the channel and floors), and `POST /rules/:id/mute`. Every read and
write is fenced per-user (owner is me) AND per-tenant (the tenant is one I can currently
reach), resolved server-side through `resolveAccessibleTenantIds`.

The access fence (`artifacts/api-server/src/lib/auth/tenantScope.ts`) gains `accessPairKey`
(a null-byte-joined (user, tenant) key that two uuids can never collide on) and
`resolveAccessiblePairsForUsers` (the batch reachability set for a set of users, only over
active seats). Both the evaluator and the drainer use these so a revoked binding can never
mint or deliver an event (see Acceptance evidence and Logged drift below).

Portal (`artifacts/portal/`): `lib/pushApi.ts` (a framework-free client returning honest
discriminated states, and a small pub/sub that emits on a successful mark so the nav badge
re-reads), `components/pages/NotificationsPage.tsx` (the center with distinct loading, empty,
ready, and error states; per-event impact and rank; read and read-all; rule tuning and mute),
the `/notifications` route in `Shell.tsx` with NO client-side role gate (the server fences),
and the `TopNav` NavBell unread badge that subscribes via `onUnreadInvalidated`.

## Acceptance evidence

- Material breach to a ranked digest: the integration test seeds a high-value action and a
  missed measurement, runs the evaluation, asserts pending events recorded with the right
  titles and a positive rank, then drains and asserts a single ranked digest is delivered to
  the chosen channel with the events flipped to `sent`.
- Low-impact suppressed: a candidate below a rule's `minImpactUsd` / `minConfidence` floor is
  recorded `suppressed` (visible in the center) and never delivered, proven by the math unit
  tests and the integration drain.
- Tune and mute without losing high signal: the test patches a rule's channel and floors and
  mutes a rule, then asserts the muted rule's later candidate is recorded suppressed rather
  than delivered, while an unmuted high-signal candidate still delivers.
- Idempotent: re-running the evaluation over the same unchanged state inserts no duplicate
  (ON CONFLICT on `(ruleId, dedupeKey)`), proven by a second pass that creates zero new rows.
- Revocation is honest on BOTH the mint and the deliver path (the remediated finding below):
  a client org bound to a tenant gets pending client and owner events; after the binding is
  revoked and a new breach occurs, the evaluator mints a new event for the owner and NONE for
  the now-unbound client, and the drainer fails the client's stale pending row in place
  WITHOUT delivering it while the owner's row delivers `sent`.
- No fabricated figures: every event figure is computed or null; an event with no dollar
  figure ranks last and is suppressed, never promoted, and the digest renders a null impact as
  an empty bracket, never a fabricated `$0`.

## Verification

- Typecheck green across all workspace projects (exit 0).
- Build green (exit 0; portal 1748 modules, api-server bundled).
- Full suite green at 685 tests: api-server 357 across 41 files (the new `pushMath` unit
  tests, the push integration tests including the revocation regression, +23 over Phase Y's
  334), portal 193 across 15 files (the new `pushApi` tests, +16 over Phase Y's 177), cortex
  84, connectors 29, edge-agent 10, db 8, scripts 4.
- Long-dash sweep zero on BOTH sides: a fresh `rg` over the authored tree (lib, artifacts,
  docs, scripts, replit.md, .replit, .github) returns zero, and a database-wide cast over
  every public text and jsonb column (123 columns; Phase Z added the `push_rules` and
  `push_events` text and jsonb columns) reports `TOTAL DASH HITS 0`.
- Zero new npm dependencies.

## Logged drift and deviations

- Per-user rules, not per-org. A `push_rules` row belongs to exactly one user
  (`ownerUserId` NOT NULL), so one user muting a kind never silences another user's signal and
  the notification center, read-state, and tuning are all per-seat. This is a deliberate
  product decision logged as a deviation from a hypothetical per-org rule model; it costs a
  default rule per (user, tenant, kind) but keeps the surface honest per seat.
- One channel per rule, snapshotted onto the event. A rule has a single `channel`, copied to
  the event at creation so a later channel change never rewrites delivered history. A fan-out
  to multiple channels per rule is a later additive change, not built this phase.
- A single global scheduled loop, not per-rule cadence. The Morning Brief evaluates and drains
  on one platform cadence (`PUSH_MORNING_BRIEF_INTERVAL_MS`); a per-rule schedule is not
  built. The evaluation accepts optional `restrictToUserIds` / `restrictToTenantIds` seams so
  a test (or a future per-user trigger) can confine a pass hermetically.
- `failed` is reused for access-revoked rows; there is no separate `revoked` delivery status.
  A row whose (owner, tenant) binding was revoked after it went pending is failed in place
  (visible in the center, never delivered), which avoids an enum migration and keeps the
  lifecycle to four honest states.
- The `/notifications` Shell route carries NO client-side role gate, mirroring the Phase Y
  posture: the server fences every read and write per-user and per-tenant, so a seat only ever
  sees its own notifications for tenants it can reach.
- `slack` and `email` are available-not-connected external sinks (they fail loudly on deliver
  when unconfigured, marking the group `failed` rather than dropping it); `in_app` is the
  always-available default that needs no external sink.

## Remediation iterations

- First architect `evaluate_task`: FAIL on a broken-access-control finding. A push rule whose
  tenant binding was revoked after the rule was created still sat enabled in `push_rules`, so
  the scheduled evaluation would mint new events for it AND the drainer would deliver them to
  an external channel, leaking a tenant's business intelligence to a recipient who could no
  longer read it in the center. The fix closes BOTH paths: the evaluator fences its loaded
  rules to the (user, tenant) pairs reachable RIGHT NOW (`accessiblePairs`) before minting, and
  the drainer re-verifies access at delivery time via `resolveAccessiblePairsForUsers`, failing
  any claimed row whose pair is no longer reachable in place without handing it to a transport.
  A self-contained revocation integration test was added as the regression guard (a client org
  bound to a tenant, evaluate, revoke the binding, new breach, re-evaluate and drain, then
  assert the client mints nothing new and its stale row is failed-not-delivered while the owner
  still delivers). The drainer change also covers disabled and downgraded seats, because
  `resolveAccessiblePairsForUsers` resolves pairs only for active users.
- Second architect `evaluate_task`: PASS. The broken-access-control finding is resolved on both
  the mint and the deliver path and the regression test fences it; no high-severity
  correctness, security, or constraint violation remained.

## Gate

Phase Z passed its architect `evaluate_task` review (PASS after the broken-access-control
remediation above). The drift index, the rollup, and the V2 build report are updated to
"A through Z". Phase Z is NOT a milestone; per the owner-authorized Stage 4 run, execution
continues to Phase AA and does not pause here (the pause is at the Stage 4/5 boundary before
Phase AD; the next protocol milestone hard stop is AI at the end of Stage 5).
