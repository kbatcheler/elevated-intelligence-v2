# Phase P: observability and alerting

Phase id: P. Name: Observability and Alerting. Milestone: no, but gated (a per-phase hard
stop for owner review, here deferred because the owner authorized an autonomous run of O,
P, and Q back to back).

Phase O built the operational unhappy path and an alert SEAM that records each operational
event as a pending `alert_events` row. Phase P is the other half of that seam: it delivers
those events to a human, aggregates errors to an external collector, gives the owner a
live operations view, and turns the health endpoint into an honest per-dependency probe.
The single hard rule is unchanged: nothing is fabricated. There is no Sentry project and
no Slack or webhook endpoint connected, so both the error reporter and the notifier
transports are modelled as honest, tested adapters that report "available, not connected"
(a no-op reporter, a log sink) until their env is set, exactly mirroring the KMS pattern.
The health route never reports a fabricated "ok": a dependency it cannot actually probe
reads `unknown` or `not_configured`, not healthy. This phase added zero npm dependencies
and contains no em-dash or en-dash.

## What Phase P built

- The Sentry-compatible error reporter
  (`artifacts/api-server/src/lib/observability/sentryReporter.ts`): `parseDsn` splits a
  standard Sentry DSN into its ingest origin, project id, and public key with no SDK;
  `HttpSentryReporter.captureError` builds a Sentry envelope by hand (event id, timestamp,
  level, platform, and either a structured exception with a stack or a message) and POSTs
  it to the store endpoint over the Node global fetch, best-effort, with a bounded timeout
  (`SENTRY_TIMEOUT_MS`). The default is `NoopSentryReporter`: with no `SENTRY_DSN` the
  reporter is "available, not connected" and `captureError` is a silent no-op rather than a
  boot crash. The payload is an allowlist of scalar context only (subsystem, route, level,
  tenant id, run id, and similar identifiers); it never carries a request body, request
  headers, raw connector records, or any secret. `captureError` never throws into its
  caller, so an observability outage can never alter or delay a real request. `setSentryReporter(null)`
  restores the no-op for tests.
- The pluggable alert notifier (`artifacts/api-server/src/lib/alerts/notifier.ts`):
  `drainPendingAlerts` claims pending `alert_events` rows with `FOR UPDATE SKIP LOCKED`
  inside a transaction (so two drain ticks, even across instances, never deliver the same
  row twice), formats each via `formatAlertText` from routing fields and scalar details
  only, delivers it through the configured transport, and marks the row `sent` on success
  or `failed` on a terminal delivery failure. `getNotifierTransport` selects the transport
  from env: a Slack incoming webhook (`SLACK_WEBHOOK_URL`), a generic JSON webhook
  (`ALERT_WEBHOOK_URL`), or, when neither is set, the honest default log sink. The webhook
  transports POST over the Node global fetch with a bounded timeout
  (`ALERT_NOTIFIER_TIMEOUT_MS`). `startAlertNotifier` runs the drain loop on an interval
  (`ALERT_DRAIN_INTERVAL_MS`) from the server entrypoint only (never from app.ts, so
  importing the app in a test starts no timer), never overlaps ticks, swallows a tick
  failure, and unrefs its timer, exactly as the Phase O connector maintenance loop does.
- The six alert triggers wired into the notifier seam. Phase O already emitted
  `connector_error_transition` (a connection going to error); Phase P adds the remaining
  emitters so the notifier delivers all five required event classes plus the connector one:
  - seed run failure: the orchestrator's `runLayer` catch path emits `seed_run_failed`
    through the `Alerter` and calls `captureError`, so a failed layer is both alerted and
    aggregated.
  - budget threshold breach: `budget.ts` emits a `budget_threshold` alert through a
    `emitBudgetThresholdOnce` helper that dedupes by an entity id scoped to the cap kind
    and month (`tenant:<id>:YYYY-MM` or `global:YYYY-MM`), on both the tenant and the
    global threshold branch, so crossing a threshold alerts once per month per scope rather
    than on every priced call.
  - break-glass grant used: the security route emits `break_glass_used` after the access is
    appended to the audit (`logSignalAccess`), so the alert and the audit row are
    consistent.
  - provenance chain integrity failure: the provenance verify route emits
    `provenance_integrity_failed` when `verifyChain` returns `ok === false`, never on a
    clean chain.
- The owner Operations route (`artifacts/api-server/src/routes/operations.ts`): an
  owner-only `GET /api/operations` (mounted behind `requireAuth` and `requireOwner`) that
  returns, all derived from real tables: the in-flight runs with their current stage, the
  recent failures with the stage that failed, the live seed-queue depth read from the
  `pipeline_jobs` claim queue as running and waiting counts, and the recent alert feed from
  `alert_events`. Every figure is a query against persisted state; there is no synthesized
  metric.
- The structured health route (`artifacts/api-server/src/routes/health.ts`, rewritten):
  the endpoint returns a per-dependency status object rather than a bare "ok". The database
  is probed with a real round-trip; the secret store reachability is probed through its
  status seam; the two model providers report `configured` or `not_configured` from whether
  their env is present, and only escalate to a live reachable check when a deep probe is
  explicitly requested (`?deep=1` or `HEALTH_DEEP_CHECK=1`), because a health endpoint must
  not silently bill a model call on every poll. A dependency that cannot be probed reads
  `unknown`, never a fabricated `ok`. The overall status is the honest worst-of the
  per-dependency states.

## The honest adapters: why nothing is faked

Three of the Phase P capabilities have no real external endpoint behind them yet, and the
honest way to ship them is as a tested adapter that reports "available, not connected", not
a fake.

- Error aggregation has no Sentry project connected. With no `SENTRY_DSN` the reporter is
  the no-op, `captureError` does nothing, and no envelope is fabricated. When a DSN is set,
  `HttpSentryReporter` posts a real envelope to the real ingest endpoint; the unit tests
  prove the DSN parse, the envelope shape, the scalar-only payload, and that a delivery
  failure is swallowed rather than propagated.
- Notification delivery has no Slack or webhook endpoint connected. With neither env set
  the transport is the log sink, which records the alert to the structured log and marks
  the row sent honestly; a webhook transport is selected only when its env is present and
  posts a real request. No alert is invented; the notifier only ever delivers rows that an
  emitter actually recorded.
- The model-provider health is reported from configuration unless a deep probe is asked
  for, so the default health poll never claims a provider is reachable that it did not
  contact and never spends a model call to answer a liveness check.

## Acceptance checklist

1. A deliberately failed seed appears in Operations and fires exactly one notification.
   Met. `operations.integration.test.ts` seeds a failed run and asserts it surfaces in the
   recent-failures list with its failing stage and that the queue-depth counts are real;
   `notifier.integration.test.ts` records a pending alert, drains it, asserts it is
   delivered once and its row flips to `sent`, and that a second drain delivers nothing
   (the `FOR UPDATE SKIP LOCKED` claim plus the status flip make delivery exactly-once per
   row). The break-glass emit is asserted in `security.integration.test.ts` (a
   `break_glass_used` row is recorded on a grant use).
2. The health route reports per-dependency status. Met. `health.integration.test.ts`
   asserts the structured response carries an entry per dependency (database, secret store,
   both model providers), that the database probe reflects the real connection, and that an
   unprobed provider reads an honest non-fabricated state rather than `ok`.

## New routes and env

- Route: owner-only `GET /api/operations`, mounted behind the existing auth and owner
  guards. The health route is the existing `GET /health`, rewritten to the structured
  per-dependency shape.
- No new table and no new column: the notifier advances the `notification_status` on the
  `alert_events` table that Phase O created, and every Operations figure reads existing
  tables (`tenant_pipeline_runs`, `pipeline_jobs`, `alert_events`).
- Env (all optional, all honest defaults): `SENTRY_DSN`, `SENTRY_RELEASE`,
  `SENTRY_TIMEOUT_MS` for the error reporter; `SLACK_WEBHOOK_URL`, `ALERT_WEBHOOK_URL`,
  `ALERT_NOTIFIER_TIMEOUT_MS`, `ALERT_DRAIN_INTERVAL_MS` for the notifier;
  `HEALTH_DEEP_CHECK` to opt the health route into live model-provider probes. With none of
  these set the system runs fully: no error aggregation, alerts to the log sink, and a
  configuration-based health report.

## Logged drift and deviations

- Notification delivery is at-least-once-per-process-life, not crash-idempotent across a
  mid-delivery process death. `drainPendingAlerts` claims a row with `FOR UPDATE SKIP
  LOCKED`, delivers, then commits the `sent` status, so concurrent drains never duplicate
  and a delivered row is not re-delivered; but if the process dies after the webhook POST
  and before the status commit, that one alert could be re-delivered on restart. A
  delivery-side idempotency key is the production hardening, deferred until a real external
  sink is connected.
- The budget threshold dedupe is a select-then-insert keyed by the scope-and-month entity
  id without a database unique constraint, so two seeds crossing the threshold in the same
  instant could each record a threshold alert. A unique index on the dedupe key is the
  hardening; it is recorded here and in `docs/deploy-readiness.md` rather than added now,
  because the single-instance dev runtime cannot exercise the race and the addendum forbids
  speculative schema.
- The error reporter and both notifier webhook transports run inside the application
  process; a multi-instance deployment runs one notifier loop per instance, which the
  `SKIP LOCKED` claim makes safe (each row is delivered by exactly one instance) but means
  the drain interval is per instance. This matches the existing in-process-loop caveat from
  Phase O already recorded in `docs/deploy-readiness.md`.
- The default health poll reports the model providers from configuration, not a live
  round-trip, to avoid billing a model call on every liveness check; the live check is
  opt-in (`?deep=1` or `HEALTH_DEEP_CHECK=1`). This is the honest tradeoff, not a
  fabricated `ok`.

## Verification

- Typecheck and build are green across the workspace (exit 0 on both).
- The full suite is green at 464 tests (api-server 184 across 25 files, portal 149,
  cortex 80, connectors 29, edge-agent 10, db 8, scripts 4). New this phase: the Sentry
  reporter unit tests (DSN parse, envelope shape, scalar-only payload, swallowed delivery
  failure, no-op default), the notifier integration tests (claim-and-deliver, exactly-once
  per row, log sink, terminal failure marks the row failed), the health integration tests
  (per-dependency structured status, honest unprobed states), the operations integration
  tests (failed run in recent failures with failing stage, real queue depth), the budget
  threshold integration test (one alert per scope per month), and a `break_glass_used`
  assertion added to the security integration suite.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, and
  scripts is zero, and a per-row cast over every text and jsonb column in every public
  table is zero.
- Zero new npm dependencies (the Node global fetch, the existing pg, and workspace
  packages only).

## Remediation iterations

- The architect `evaluate_task` review returned a PASS, confirming the no-SDK no-secret
  Sentry envelope, the seam-to-notifier exactly-once-per-row delivery, the honest health
  states, the real Operations aggregation, and full emit coverage of the five required
  event classes. Two non-blocking production-hardening notes were recorded for when a real
  external sink is connected and the deployment goes multi-instance: add a delivery-side
  idempotency key so a crash between webhook POST and status commit cannot re-deliver, and
  add a unique constraint on the budget threshold dedupe key so concurrent seeds cannot
  duplicate a threshold alert. Both are deferred deliberately, as no production code path
  can exercise either on the single-instance dev runtime with no sink connected.

## Gate

Phase P is a per-phase gated stop. The owner authorized an autonomous run of Phases O, P,
and Q back to back, so execution does not pause here; it proceeds to Phase Q and stops for
owner review only after Phase Q.
