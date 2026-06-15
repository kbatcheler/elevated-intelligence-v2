# Milestone drift report: Phase T (A through T)

This is the consolidated drift report for the Phase T milestone review boundary, written per
Section 4 of the Autonomous Execution and Drift Control Protocol. Phase T is a designated owner
review point (the client onboarding experience and tenant fencing), and `PAUSE_AT_MILESTONES`
is true, so execution stops here for owner review. The per-phase reports in this directory
(`phase-A.md` through `phase-T.md`) remain the primary record; this report rolls the build up to
the milestone so the corners cut, the defaults taken, and the open caveats are all visible in
one place.

## Run context and gate status

- Run mode: autonomous, phase after phase, with the Phase Gate replacing human confirmation,
  except at the milestones flagged in the index (C, G, H and I, K, T, X, AI, AJ).
- This milestone closes the owner-authorized R-S-T run (Stage 3, phases R, S, and T executed
  back to back). T is itself a milestone hard stop, so the run ends here regardless.
- Every phase A through T has passed its gate. No `docs/drift/STOP.md` exists; there is no
  unresolved blocking drift.

## Phase verdicts (A through T)

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | Pass | yes |
| D | Auth, Orgs and Access | Pass | no |
| E | Product Surfaces | Pass | no |
| F | Fast Seeding and World-Class Seed Data | Pass | no |
| G | Parity Gate and Core Build Report | Pass | yes |
| H | Connector Framework and Registry | Pass | yes |
| I | Connected Mode, Edge Agent, Runtime No-Write Guard | Pass | yes |
| J | Split Pipeline (Tier 2, Lens In-Boundary) | Pass | no |
| K | Tier 3: Crypto Isolation, No Standing Access, Hash-Chained Provenance | Pass | yes |
| L | Connected Portal Security Surfaces | Pass | no |
| M | Stage 2 Full Verification and Build-Report Append | Pass | no |
| N | Cost and Token Observability | Pass | no |
| O | Connector Operational Reality | Pass | no |
| P | Observability and Alerting | Pass | no |
| Q | Secrets Vault | Pass | no |
| R | Expand Test Coverage and Confirm CI | Pass | no |
| S | Retention and Deletion | Pass | no |
| T | Client Onboarding Experience | Pass | yes (paused for owner review) |

## Requirements checklist (the R-S-T run, against the adaptation guide)

Phase R (expand test coverage and confirm CI). Adapted from "introduce testing": Vitest and a
CI workflow have existed since Phase B, so R proves every load-bearing invariant has a test that
turns red when broken and fills the one real gap.

1. DerivedSignalSet guard rejects raw records. Done: `lib/db/src/contracts/derivedSignalSet.test.ts` (8 tests).
2. Extraction path holds no db handle and no filesystem write. Done: static import-boundary
   tests in `lib/connectors/src/importBoundary.test.ts` and `artifacts/edge-agent/src/importBoundary.test.ts`.
3. PIN validation: wrong, expired, revoked, and used-up each return one byte-identical error;
   a valid PIN succeeds and decrements exactly once. Done: api-server auth route suite.
4. requireOwner refuses a member, passes an owner. Done: api-server auth/access suite.
5. Session cookie verifies valid, rejects tampered and expired. Done: `artifacts/api-server/src/lib/auth/session.test.ts`.
6. Provenance ledger append-only and a broken chain is detected. Done: api-server provenance suite.
7. Prompt hygiene guard scans prompt sources and bites on a literal example figure. Done (the
   one filled gap): `lib/cortex/src/prompts/promptHygiene.ts` plus `promptHygiene.test.ts` (4 tests).
8. Long-dash guard scans authored source. Done: `scripts/src/emDashGuard.test.ts` (4 tests).
9. CI runs typecheck, build, and test as separate required steps and blocks on any nonzero
   exit. Done: `.github/workflows/ci.yml` (`verify` job; the hosted runner cannot execute in
   this environment, so the same four steps run locally and pass, an accepted environmental drift).

Phase S (retention and deletion).

1. Configurable TTL purge of derived signals, default 90 days, refresh resets the clock. Done:
   `runRetentionPurge` over `RETENTION_TTL_DAYS` in `artifacts/api-server/src/lib/retention/retention.ts`;
   `RETENTION_TTL_DAYS` default documented in `replit.md`.
2. Scheduled, from the entrypoint only, no overlap, swallow tick failure, unref timer. Done:
   `startRetentionPurge` (`RETENTION_PURGE_INTERVAL_MS`, default 6 hours), mirroring the
   connector-maintenance and notifier loops.
3. Tenant-scoped erasure deletes derived signals and appends an append-only ledger redaction in
   the same transaction so `verifyChain` still passes. Done: `eraseTenantDerivedSignals` via the
   new `appendEntryTx`; `claimPath` `redaction:derived_signals:tenant`, `sourceRef` `sha256:<digest>`.
4. Token-scoped erasure. Partial by design: rejected for aggregate signals with
   `token_erasure_not_supported_for_aggregate_signals`, because derived signals are aggregate
   math with no identity thread. Logged as a decision, not a silent skip.
5. Every purge and erasure logged with what, when, authority. Done: `retention_events` audit
   table; an empty purge tick writes no row (honest empty state).

Phase T (client onboarding experience, MILESTONE). Adapted from "add organizations": orgs,
roles, scoped PINs, and tenant fencing landed in Phase D, so T builds the self-serve onboarding,
the client first run, and the runbook on that base.

1. Client-admin mints client-viewer PINs scoped to their own org and role, cannot reach the
   provider side. Done: `/api/client` router (`artifacts/api-server/src/routes/client.ts`),
   session-gated and client-admin only, scope forced server-side; a widening attempt is rejected
   with `scope_org_forbidden` / `scope_role_forbidden`.
2. Client side has an honest first run with diagnosis in two clicks. Done: `Onboarding.tsx` over
   a framework-free typed `clientApi.ts` with distinct loading, empty, ready, and error states.
3. Client-viewer fenced: own tenant only, 403 on provider routes and other tenants, never spend
   or connector internals; sees diagnosis, reasoning, provenance. Done: Phase D fencing plus the
   new break-glass provider-only narrowing in `security.ts`.
4. Client-viewer is strictly read-only on the track record. Done (extends the plan's read list,
   the logged milestone decision): both action mutation routes in `tenants.ts` 403 a
   client-viewer; the war room hides the controls.
5. Documented rollout runbook. Done: `docs/client-onboarding-runbook.md`.

## Anti-gaming affirmation (Section 7)

- The Confounder, the three external model seats, and the cortex telemetry are real and running.
  They were built and verified on a real end-to-end seed in Phase C and have been exercised by
  every live seed since; per-seat cost and token telemetry was added against real billed calls in
  Phase N. Phases R, S, and T did not modify the Confounder, the model seats, or the telemetry
  pipeline. Their contracts remain under the green suite (cortex 84 tests, including grounding,
  schema, pricing, and the split-pipeline routing). No stub, script, or static demo datum stands
  in for a live run anywhere in this run.
- No test or acceptance criterion was weakened, skipped, disabled, or deleted to make a phase go
  green. In Phase T the positive action-write tests were moved to a genuinely authorized actor (a
  bound client-admin) rather than relaxing the role gate, and the ledger surface test was widened
  to admit the new append-only `appendEntryTx` while still asserting no update or delete export.
- No table was renamed, no library swapped, and no layout restructured to route around a problem
  during R, S, or T. New tables (`retention_events`) and a new router (`/api/client`) are
  additive.
- Every embedded decision default is logged below, not silently chosen.

## Drift items

No blocking drift. The verdict is pass with the noted acceptable drift below.

Acceptable drift introduced or reconfirmed in the R-S-T run:

- CI cannot execute inside this environment (B, reconfirmed R). The GitHub Actions `verify`
  job's four steps (install, typecheck, build, test) run locally and pass, which is the same
  evidence the hosted job would produce.
- Token-scoped erasure unsupported for aggregate signals (S). Refused honestly rather than
  widened to a full tenant erasure; a future per-identity store would add the real path.
- Provenance ledger append-only is enforced in the application plus the hash chain, not yet at
  the database role (K, reconfirmed by S's `appendEntryTx`). Revoking UPDATE and DELETE at the
  database-role level is a deployment-time hardening left to the operator.

Long-standing acceptable drift still live at the milestone (full detail in `rollup.md`):

- In-memory auth rate limiter and in-memory connector token buckets are per process; both need a
  shared store before horizontal scaling. Captured in `docs/deploy-readiness.md`.
- `SESSION_SECRET` coupling: rotating it invalidates all sessions and all outstanding PINs at
  once. Operational caveat.
- Local KMS is a software key store, not an HSM; the customer-managed-key path is a swappable
  "available, not connected" adapter.
- Live seed concurrency benched at `LAYER_CONCURRENCY=2` against provider 429s; the default of 5
  is honest but conservative timings were recorded at 2.

Categories actively checked and clear for R, S, T: no faked or stubbed output where real output
was required; no renamed table, substituted library, or restructure to dodge a problem; no
regression-contract surface changed behaviour (the outside_in pipeline is untouched and still
byte-for-byte identical); scope added is only the explicit client-viewer write refusal, which is
the logged milestone decision; the silent-assumption sweep surfaced only the logged defaults.

## Decisions taken (logged embedded defaults)

- Client-viewer is a strictly read-only seat (T, the milestone decision). The plan's read list
  was diagnosis plus reasoning plus provenance; the applied and architect-endorsed default adds
  an explicit write refusal, so a client-viewer is 403 on both action mutation routes and on the
  break-glass raw-signal read, and the portal hides any control it would be refused. Provider
  seats and the client-admin (on their own bound tenant) remain the writers. A separate client
  action-writer role is the future path if customer governance ever needs one.
- Client-admin onboarding is scope-forced, never scope-trusting (T). A `scopeOrgId` or
  `scopeRole` in the request body exists only so a widening attempt is rejected loudly, never
  silently overridden; a shared `mintInvitePin` helper backs both the client and owner routes so
  they cannot drift.
- Break-glass is provider-only (T). Phase K bound the raw-signal read to every role under an
  active grant; T narrows it to provider roles, because a client boundary that fences off source
  data must also fence off its closest proxy.
- TTL default 90 days, purge cadence 6 hours (S). Recommended defaults applied and documented;
  both overridable by env.
- Token-scoped erasure rejected for aggregate signals (S). See drift items.

Earlier milestone-relevant defaults remain logged in `rollup.md` (for example the Phase N
cost-cap values and the Phase H connector-framework deployment choice).

## Test and verification summary (current state)

- Typecheck: clean across the workspace (exit 0).
- Build: clean (portal and api-server build artifacts produced).
- Full suite: green at 526 tests: api-server 227, portal 164, cortex 84, connectors 29,
  edge-agent 10, db 8, scripts 4. The R-S-T run added 44 tests net (R +4 prompt hygiene; S the
  retention and ledger-surface coverage; T +31 across the client route, the read-only proofs,
  and the portal client).
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, `.replit`, and `.github` reports zero, and a database-wide cast over every text
  and jsonb column in every public table reports zero.
- Zero new npm dependencies across R, S, and T.

## Verdict

Pass with noted acceptable drift, at the Phase T milestone. There is no blocking drift and no
faked output. Per `PAUSE_AT_MILESTONES = true`, execution pauses here for owner review and does
not auto-advance past Phase T.
