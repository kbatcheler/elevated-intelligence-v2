# Phase O: connector operational reality

Phase id: O. Name: Connector Operational Reality. Milestone: no, but gated (a per-phase
hard stop for owner review, here deferred because the owner authorized an autonomous run
of O, P, and Q back to back).

The connector addendum (Phases H through L) built the clean extraction path. Phase O
builds the unhappy path that production actually is: tokens expire, client APIs throttle,
connections go stale and die, and an operator must be told. It adds an OAuth token refresh
scheduler, a per-connection token-bucket rate limiter sized from the registry quota
profile, a read-time connector health derivation surfaced in the Connections and Security
posture views, incremental-extraction cursor plumbing that persists only the watermark,
and an alert SEAM that records each operational event as a pending row for the Phase P
notifier to consume. The single hard rule is unchanged: nothing is fabricated. There is no
live OAuth runtime and no incremental-capable connector yet, so both are modelled as
honest, tested seams that report "available, not connected" rather than faking a renewal
or an incremental number. This phase added zero npm dependencies and contains no em-dash
or en-dash.

## What Phase O built

- The alert SEAM (`artifacts/api-server/src/lib/alerts/alerter.ts`): one `Alerter`
  interface with a single `emit(event)` method, an `AlertEvent` whose details payload is
  scalars only by construction (so an emitter cannot attach a secret object or a raw
  client record), and a default `DbAlerter` that records one pending row in `alert_events`
  and then logs only the routing fields (type, severity, ids), never the message body or
  the details. Consumers depend on the interface, never on a sink, so wiring the Phase P
  notifier touches nothing here. The type and severity vocabularies are derived from the
  schema enums so the code and the table can never drift apart.
- The `alert_events` table: an operational ledger decoupled from the tenant lifecycle
  (tenantId nulls out on a tenant delete rather than cascading the history away), with a
  `notificationStatus` (pending, sent, suppressed, failed) that the Phase P notifier will
  advance. The type enum declares all six alert kinds now (the two Phase O emits plus the
  four Phase P will), so the notifier needs no enum migration.
- OAuth token refresh (`artifacts/api-server/src/lib/connectors/oauthRefresh.ts`):
  `runDueOAuthRefreshes` selects connected connections that have a recorded token expiry,
  keeps only the oauth2 descriptors, and renews each one that is at or inside its
  per-connector `oauthRefreshLeadSeconds` window. A success writes the new expiry and
  clears any prior error (rotating the stored credential reference when the provider
  rotates it); a failure flips the connection to `error` with `lastErrorCode =
  reauthentication_required`, records the reason, and emits a critical
  `oauth_refresh_failed` alert. The default `NotImplementedTokenRefresher` rejects
  honestly because no oauth2 runtime is connected, so the scheduler is proven with an
  injected refresher exactly as the edge agent and boundary runtime are proven with
  injected stubs. `startConnectorMaintenance` runs the loop from the server entrypoint
  only (never from app.ts, so importing the app in a test starts no timer), never overlaps
  ticks, swallows a tick failure, and unrefs its timer.
- The per-connection rate limiter
  (`artifacts/api-server/src/lib/connectors/rateLimiter.ts`): `takeToken` is an in-process
  token bucket sized from the descriptor's `quotaProfile` (capacity and refill rate),
  enforced before each extraction so we never exceed a client API's own throttle.
  `runWithThrottleRetry` retries ONLY a typed `ConnectorThrottleError` (a 429 or
  equivalent) up to the profile's `maxAttempts`, honoring a server `Retry-After` hint when
  present and otherwise backing off exponentially, capped at `maxRetryAfterSeconds` so a
  hostile or oversized hint cannot stall the runtime. A genuine `Error` propagates on the
  first throw and is never retried, which is the distinction the acceptance set requires.
  This mirrors the seed-runner 429 handling.
- Read-time connector health
  (`artifacts/api-server/src/lib/connectors/connectionHealth.ts`):
  `deriveConnectionHealth` returns `error` when the connection is flipped to error,
  `degraded` when it is connected but not currently trustworthy (never succeeded, last
  success older than the staleness threshold, or an error newer than the last success),
  and `healthy` otherwise. It is derived from the real timestamps on every read and never
  stored, so it cannot drift from reality between writes, and a connection that has never
  run reads as degraded rather than healthy.
- The connected-refresh integration
  (`artifacts/api-server/src/lib/connectors/connectedRefresh.ts`): the Tier 1 boundary
  runtime now takes a token from the bucket before each extraction (waiting the reported
  time, capped, if the bucket is momentarily empty), wraps the guarded extraction in the
  throttle-retry so a throttled source backs off and recovers WITHOUT failing the run,
  records `lastSuccessAt` (which drives the health derivation) and resets the status to
  connected on success, and on a failure flips the connection to error with a
  `rate_limited` or `extraction_failed` code and emits a `connector_error_transition`
  alert ONLY on the transition into error (a persistently broken connection does not
  re-alert every cycle). Both alert emissions are best-effort so a recording failure never
  masks the underlying refresh failure.
- Owner-only connector health route: `GET /api/security/tenants/:id/connector-health`
  derives each connection's health at read time with a 24 hour staleness fallback for a
  connector with no declared threshold, and orders the rows worst-first (error, then
  degraded, then healthy, then by name) so an operator sees the problems first.
- Portal surfaces: a new `ConnectorHealthSection` renders the health list with honest
  loading, empty, error, and unauthorized states, wired into BOTH the Connections security
  panel and the Security posture panel; `securityApi.fetchConnectorHealth` and a
  `ConnectorHealth` type carry the typed outcome.

## The two honest seams: why nothing is faked

Two of the four Phase O capabilities have no real runtime behind them yet, and the honest
way to ship them is as a tested seam, not a fake.

- OAuth refresh has no oauth2 connector runtime in the system; every oauth2 connector is
  declared "available, not connected". The default refresher therefore throws honestly
  rather than inventing a new expiry, and the scheduler treats the throw exactly as a real
  failed renewal: error status, re-authentication required, a critical alert. When a real
  oauth2 runtime exists it implements `TokenRefresher` and is wired in; nothing else in
  the module changes.
- Incremental extraction is plumbed end to end (a `WatermarkValue` on the contract, a
  `nextWatermark` returned alongside the derived set from `guardedExtractSignals`, the
  cursor passed to a connector only when its descriptor declares it supports one, and the
  watermark persisted only when `descriptor.incremental.supported && nextWatermark !==
  undefined`, never the source data behind it). But every production descriptor keeps
  `incremental.supported = false`, because the only connector runtimes that exist are the
  bring-your-own-warehouse pair that compute whole-table aggregates; treating a
  partial-new-rows aggregate as an incremental continuation would fabricate a number. So
  the cursor seam is real and tested (by temporarily enabling support on a descriptor in a
  test and restoring it in a finally), and dormant in production, where every refresh does
  the honest full derive and any returned cursor is dropped.

## Acceptance checklist

1. A connection with an expiring token refreshes on its own. Met. `runDueOAuthRefreshes`
   renews every connected oauth2 connection inside its lead window with an injected
   refresher; the integration test proves a due token is renewed, a not-yet-due token is
   left alone, a non-oauth connection is skipped, and a failed renewal flips the
   connection to error with re-authentication required and emits the critical alert.
2. A throttled source backs off and recovers without failing the run. Met. The
   connected-refresh test drives a connector that throws `ConnectorThrottleError` on its
   first attempt and succeeds on the next; the run recovers and persists its signals, with
   sleep injected so the test advances a fake clock rather than waiting. The rate-limiter
   unit tests prove the bucket burst-then-refill behavior, the Retry-After honoring, the
   exponential fallback, the cap on an oversized hint, attempt exhaustion, and that a
   genuine error is never retried.
3. A dead connection shows as error and fires an alert. Met. The connected-refresh test
   drives a connector that throws a genuine error, asserts the connection reads as error
   and exactly one transition alert is captured, and a second failing cycle on the
   already-error connection captures NO new alert (transition-only, no re-alert).
4. Health is derived honestly and surfaced. Met. `deriveConnectionHealth` is unit-tested
   across healthy, stale-degraded, never-run-degraded, newer-error-degraded, and error;
   the owner route returns it worst-first; both portal panels render it with honest
   non-fabricated states.
5. The alert SEAM exists for Phase P. Met. Every operational event is emitted through the
   one `Alerter` interface and recorded as a pending `alert_events` row; the notifier that
   consumes the pending rows is Phase P and depends only on this interface.

## New table, route, columns, and env

- Table: `alert_events` (the alert SEAM ledger described above).
- Route: owner-only `GET /api/security/tenants/:id/connector-health`, mounted behind the
  existing auth and owner guards.
- Columns: `tenant_connections` gains `last_success_at`, `token_expires_at`,
  `cursor_watermark` (jsonb, the only incremental state stored), `last_error_code`,
  `last_error_at`, and `last_error_message`.
- Env: none. The refresh lead time, staleness threshold, and quota profile are
  per-connector descriptor fields in the registry, not env; the maintenance interval is a
  code default (15 minutes) with an options override, not env.

## Logged drift and deviations

- No OAuth runtime exists, so the default refresher reports not-implemented and the
  scheduler is proven with an injected refresher rather than a live token exchange. This
  is a deliberate honest seam, not a measurement; the failed-renewal path (error,
  re-authentication required, alert) is fully real and tested.
- No incremental-capable connector exists, so every descriptor keeps
  `incremental.supported = false` and the watermark plumbing is dormant in production. The
  cursor seam is real and tested by temporarily enabling support on a descriptor; until a
  real incremental runtime lands, every refresh is a full derive.
- The token bucket and the throttle-retry state are in-process and per connection, like
  the seed limiter; a multi-instance deployment would size buckets per instance. This
  matches the existing in-memory-limiter caveat already recorded in
  `docs/deploy-readiness.md`.
- The connector health is derived at read time rather than stored, which is the honest
  choice (a stored column would drift from reality between writes) but means a stale
  connection is only observed as degraded when something reads it; the OAuth scheduler is
  the only background mover and it acts on token expiry, not staleness.

## Verification

- Typecheck and build are green across the workspace (exit 0 on both).
- The full suite is green at 441 tests (api-server 161, portal 149, cortex 80,
  connectors 29, edge-agent 10, db 8, scripts 4). New this phase: the rate-limiter unit
  tests, the connection-health derivation tests, the OAuth refresh integration tests, the
  rewritten connected-refresh integration tests (throttle-recover, dead-connection with
  one alert, re-alert suppression, watermark persist-and-ignore), and the guarded-extract
  watermark and wrapper cases.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, and
  scripts is zero, and a per-row cast over every text and jsonb column in every public
  table (now including `alert_events`) is zero.
- Zero new npm dependencies.

## Remediation iterations

- The architect `evaluate_task` review returned a PASS on the first review with no severe
  findings, confirming the OAuth seam, the rate limiter, the read-time health derivation,
  the transition-only alerting, and specifically the decision to keep
  `incremental.supported = false` everywhere as honest rather than a gap. Two non-blocking
  hardening recommendations were recorded for when a real incremental connector is
  enabled: add runtime validation of the `nextWatermark` shape before any production
  incremental connector can persist it (so a buggy connector cannot store source-shaped
  data as a cursor), and sanitize a persisted `lastErrorMessage` before broad UI display
  if a future connector runtime might surface a secret in a thrown error. Both are
  deferred deliberately, as no production code path can exercise either today.

## Gate

Phase O is a per-phase gated stop. The owner authorized an autonomous run of Phases O, P,
and Q back to back, so execution does not pause here; it proceeds to Phase P and stops for
owner review only after Phase Q.
