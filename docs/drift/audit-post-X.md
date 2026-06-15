# Post-X system audit and remediation

Date: 2026-06-15. Scope: a detailed drift audit of the whole system built to date
(Phases A through X), in response to the owner request to "conduct a detailed drift
report and audit of the system built to date, list out areas of remediation and
improvement, strengthening and action those items." This is an audit pass, not a new
phase: it mints no Phase Y, advances no gate, and adds no product surface. It records
what the audit found, what was actioned in code, and what is accepted or deferred with
the operator action each needs.

## Method

- Read the live code paths, not only the per-phase reports: the benchmark cohort read,
  the encrypted-signal machine read, the seed and refresh route entrypoints, and the
  orchestrator status writes.
- Ran the regression gates through the configured workflows: `typecheck`, `build`, and
  the full `test` suite. All three exit 0.
- Ran the two-sided long-dash sweep on both sides of the boundary the hard constraint
  draws. The source guard (`scripts/src/emDashGuard.ts`) runs inside the green suite and
  reports zero. The database-wide sweep cast every public text and jsonb column to text
  and matched the em-dash and en-dash character class: 118 columns across 32 tables,
  zero on both sides.
- Submitted the remediation diff to the architect (`evaluate_task`, with the git diff):
  verdict PASS, no severe issue, benchmark privacy boundary intact.

## Posture summary (what holds)

The hard constraints all hold at audit time:

- Zero new npm dependencies; every external seam is an "available, not connected" HTTP
  adapter (KMS, GCP Secret Manager, GCS archive, Sentry, alert webhooks), not an SDK.
- ASCII hyphen only, enforced on both sides: the source guard in the suite and the
  database-wide row sweep both read zero.
- No fabricated telemetry or output: a figure is computed from persisted state or it is
  not shown. The benchmark feature publishes no stat below the k-anonymity floor and
  shows an honest lock instead; cost rows are written only on a real billed call; health
  is derived at read time from real timestamps.

## Remediations actioned

Three genuine, in-scope defects were found and fixed in
`artifacts/api-server/src/routes/tenants.ts`. All are local, dependency-free, and
covered by the green suite.

### 1. Benchmark cohort read now re-gates stale stats against the current k floor

- Finding: `buildLayerCohort` trusted the most recent `benchmark_stats` rows and did not
  re-filter them against the CURRENT `BENCHMARK_MIN_COHORT`. If an operator tightened the
  floor between recomputes, a stat computed under the looser floor could be served until
  the next recompute superseded it. This was the non-blocking item logged at Phase X.
- Risk: a distribution published under a looser k floor could remain visible for up to one
  recompute cadence after the floor was raised. Bounded, but a privacy-relevant staleness.
- Fix: compute `minCohort = getBenchmarkMinCohort()`, filter
  `eligibleStats = stats.filter((s) => s.sampleCount >= minCohort)`, gate the unlocked
  path on `eligibleStats.length`, and build the returned metrics from `eligibleStats`.
  When every stored stat is re-gated out, control falls through to the existing honest
  lock path, which counts live opted-in peers in the normalized segment and returns
  `cohortBenchmark: null` with `unlocksAt` set from the current floor. The read is now at
  least as conservative as the recompute.
- Evidence: a new integration test in
  `artifacts/api-server/src/routes/benchmarks.integration.test.ts` ("layer detail cohort
  re-gates against the current k floor") inserts a stat with `sampleCount = 7`, asserts it
  unlocks at the default floor 5, then sets `BENCHMARK_MIN_COHORT = 8` and asserts it
  re-gates to an honest lock with `unlocksAt = 8` (the env is restored in `finally`). It
  also asserts the self marker stays null for a tenant with no signals and that the
  payload carries no tenant id.

### 2. Narrowed the self-marker read catch from bare to typed

- Finding: the self-marker read in `buildLayerCohort` (the requester's own value via
  `readDecryptedSignalsForMachine`) was wrapped in a bare `catch {}` that silently
  swallowed every error, so an unexpected failure would be invisible.
- Risk: a real fault in the machine read would be masked as "no self marker" with no log,
  eroding the no-silent-failure constraint.
- Fix: the catch now swallows only the expected crypto-shred types
  (`CryptoShreddedError`, `SignalEncryptionError`), leaving `self` null for a shredded
  tenant exactly as before; anything else is logged with tenant and layer context via
  `logger.error`. The cohort distribution itself is unaffected either way, so the read
  degrades to an honest null self marker rather than failing the whole cohort. (For a
  tenant with no derived signals, `decryptTenantSignals` returns `[]` before any key
  check, so a no-signal tenant never enters the catch at all.)

### 3. Stuck "seeding" tenants are flipped to "failed" on a route-level background throw

- Finding: both `POST /tenants` and `POST /tenants/:id/refresh` pre-create or mark a
  tenant "seeding" and then run the seed in the background. The orchestrator writes its
  own terminal status, but a throw in the profile stage BEFORE the orchestrator reaches
  that write left the route-created shell stuck in "seeding" forever.
- Risk: a tenant permanently displayed as mid-seed, with no honest failed state.
- Fix: both background `.catch` handlers are now async and flip the tenant to "failed"
  via a guarded update whose WHERE clause still requires `status = 'seeding'`. Because the
  guard matches only a still-seeding row, it can never overwrite the orchestrator's later
  `ready` or `failed` terminal write; it closes only the pre-terminal hole. The honest
  failed state is now reachable from the route path too.

## Areas of improvement: accepted or deferred (not actioned, by design)

These are real and worth attention, but each is either a deployment-time or operator
responsibility, a provider constraint, or a deliberate honesty boundary. Actioning them
in application code would either break the zero-new-dependency rule or move a platform
responsibility into the app. Each is restated here with its disposition and the operator
action it needs; the full context is in the per-phase reports and `rollup.md`.

- In-memory auth rate limiter (D). Per process, resets on restart, not shared across
  instances. ACCEPT for a single instance; before horizontal scaling, move to a shared
  store or pin auth to one worker. Captured in `docs/deploy-readiness.md`.
- Connector rate-limit token buckets in-memory and per process (O). On more than one
  instance each keeps its own bucket, so the effective quota multiplies by instance count.
  ACCEPT; pin connector refresh to one worker or move the bucket state to a shared store
  before scaling. Captured in `docs/deploy-readiness.md`.
- SESSION_SECRET coupling (D). PIN hashes and session signatures both derive from it, so
  rotating it invalidates all sessions and outstanding PINs at once. ACCEPT as an
  operational caveat; documented, not a defect.
- Local KMS is a software key store, not an HSM (K). The default `KmsRuntime` holds the
  per-tenant KEKs in operator-controlled Postgres. DEFER to the operator: the
  customer-managed-key path is a swappable "available, not connected" adapter that a real
  cloud KMS or bring-your-own-key service implements with no envelope or call-site change.
- Provenance ledger append-only enforced in the application, not yet at the DB role
  (K, re-confirmed M). The module exposes only `appendEntry` and `verifyChain` and links
  entries by content hash, so any edit breaks `verifyChain`. DEFER: revoking UPDATE and
  DELETE at the database-role level is a deployment-time hardening for the operator.
- OAuth token refresh has no live oauth2 runtime (O). The default
  `NotImplementedTokenRefresher` rejects honestly and the failed-renewal path (error
  transition plus a critical alert) is fully real; the scheduler is proven with an
  injected refresher. ACCEPT as "available, not connected": building a refresher with no
  configured oauth2 connection would be fabricated telemetry, and auto-alerting on a
  not-connected connector would be alert fatigue.
- Skip-unchanged archive guard not globally serialised across processes (U). Only a manual
  trigger racing the scheduled tick could duplicate, and each object key embeds a timestamp
  plus a sha256 prefix under write-once, so a duplicate is content-identical, never a
  corruption. ACCEPT; an advisory lock or unique-digest constraint is an optional refinement.
- Connector-health staleness fallback for an unknown connector key (O). A 24h default is
  used when a descriptor has no declared staleness threshold; disclosed and minor. ACCEPT.

## Recurring environmental facts (not fixable in code)

- No manual git tags: Replit manages version control through automatic checkpoints, so
  `docs/drift/INDEX.md` is the progress source of truth.
- Hosted CI cannot execute inside this environment; the four CI steps (install, typecheck,
  build, test) run locally and pass, the same evidence the hosted job would produce.
- Owner secrets reach the workflow processes only, not the agent shell, so live owner login
  is verified via the integration suite and the bootstrapped owner row.

## Evidence

- `typecheck` exit 0; `build` exit 0; `test` exit 0 (api-server 316 tests across 37 files
  pass, including the new re-gate test).
- Source dash guard: zero (in the suite). Database-wide sweep: zero across 118 public text
  and jsonb columns over 32 tables, both the em-dash and the en-dash.
- Architect `evaluate_task` on the remediation diff: PASS, no severe issue, benchmark
  privacy boundary intact.

## Verdict

The system is in a sound state at the Phase X security-milestone hard stop. The audit
found three in-scope defects, all now fixed and covered by the green suite; the remaining
items are accepted or deferred with a clear operator action and no honesty or privacy
compromise. Phase X remains a milestone hard stop: this audit advances no gate and does
not auto-advance into the next phase.
