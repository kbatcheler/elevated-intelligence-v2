# Phase X: benchmarking and the data network effect (security milestone)

Phase id: X. Name: Benchmarking and the Data Network Effect. Milestone: yes (a security
milestone, so a HARD STOP for owner review follows; do not auto-advance into Phase Y). This
phase turns one tenant's private math into a cross-tenant benchmark WITHOUT ever exposing
another tenant's raw data or identity. A tenant that opts in sees where its own figure sits
inside a de-identified distribution of its cohort (sector by revenue band), and below the
k-anonymity floor it sees an honest lock instead of a fabricated comparison. It added zero npm
dependencies and contains no em-dash or en-dash in source or in data.

The privacy posture is the deliverable, stated plainly: the published benchmark tables hold NO
raw client values and NO tenant references of any kind. A cohort is a population count, a stat
is a distribution over that population, and the only place a tenant id touches the benchmark
path is the consent audit (which records that a named tenant opted in or out, on whose
authority) and the live layer-detail read (which positions the REQUESTING tenant's own figure
against the already-de-identified cohort stats, never against another tenant's value).

## What was built

Schema (pushed to dev Postgres with `pnpm --filter @workspace/db push`, exported from
`lib/db/src/schema/index.ts` via the new `benchmarks` module):

- `tenants.benchmark_opt_in` (`boolean`, default false): consent is off until a tenant
  explicitly turns it on. A tenant contributes to the cohort math, and can read the verified
  cohort band, only while this is true.
- `benchmark_consent_events`: one row per consent change (opt-in or opt-out) with the action,
  the authorizing user and role, an optional reason, and the timestamp. This is the ONLY
  tenant-scoped audit path in the benchmark feature; the `tenant_id` is `onDelete: set null`
  so the audit outlives the tenant.
- `benchmark_cohorts`: one row per cohort segment with `segment_key` (unique), the normalized
  `sector` and `revenue_band` dimensions, a `member_count`, and `computed_at`. DELIBERATELY no
  tenant reference: a cohort is a population, not a roster.
- `benchmark_stats`: one row per (cohort segment, layer key, signal key, window) with `p25`,
  `p50`, `p75`, a `sample_count`, a `noised` flag, and `computed_at`. DELIBERATELY no tenant
  reference and no raw value: a stat is a distribution over a population, never a list of the
  numbers that produced it.
- `benchmark_events`: one row per recompute run, identity-free by construction (action,
  `cohort_count`, `stat_count`, `skipped_tenant_count`, `min_cohort`, the authorizing user and
  role, and the timestamp). No tenant id and no per-tenant detail.

Machine scalar read helper (the de-identified contributor reading):

- The recompute reads each opted-in tenant's decrypted scalar derived signals through the
  MACHINE grounding read extracted from the orchestrator path, NOT the break-glass human read.
  The single-tenant helper fails loud (a revoked or missing key throws a typed unreadable
  error), and the batch caller catches that per tenant: an unreadable tenant is SKIPPED and
  counted in `skipped_tenant_count`, and the run continues, so one crypto-shredded tenant can
  never fail the whole recompute or silently corrupt a cohort.

Pure benchmark math (unit-tested, no database or request needed):

- Percentiles (`p25`, `p50`, `p75`) are computed over the pooled scalar readings of a cohort.
- The k-anonymity floor: a cohort with fewer than `minCohort` (default 5, `BENCHMARK_MIN_COHORT`)
  readable contributors publishes NO stat at all, so a distribution can never be reconstructed
  from a cohort too small to hide an individual.
- Bounded noise: a cohort whose `sampleCount` is in `[minCohort, noiseBand)` (`noiseBand`
  default 20, `BENCHMARK_NOISE_BAND`) is published with bounded random noise tied to a fraction
  of the IQR (`DEFAULT_NOISE_FRACTION`, 0.1) and clamped so the ordering invariant
  `p25 <= p50 <= p75` always holds; the row is marked `noised = true` and the UI surfaces it as
  "privacy protected". This is disclosed, never hidden, and never a fabricated figure: it is a
  bounded perturbation of a real distribution, labelled as such.

Recompute (the scheduled loop and the pure runner):

- `runBenchmarkRecompute({ now, minCohort, noiseBand, log })` is pure: it groups opted-in
  tenants into normalized cohorts, reads each via the machine helper (skip-and-count on
  unreadable), applies the k gate and the noise band, supersedes the prior `benchmark_cohorts`
  and `benchmark_stats` set (a recompute replaces, never appends a stale layer), and writes
  exactly one `benchmark_events` audit row.
- `startBenchmarkRecompute` runs the loop from the server entrypoint (`index.ts`) ONLY,
  mirroring the retention, notifier, and backup loops: no overlap, a swallowed tick failure, an
  unref'd timer, cadence `BENCHMARK_RECOMPUTE_INTERVAL_MS` (default 12 hours).

Routes:

- Consent (tenant-access, `requireTenantAccess`): `GET /api/tenants/:id/benchmark-consent`
  returns the persisted `optIn` and the consent event history; `POST` flips it and writes a
  consent event in the same transaction only when the state actually changes. A read-only
  client-viewer seat is refused server-side with 403; the UI also hides the control but does
  not rely on that for authorization.
- The layer-detail route returns `cohortBenchmark | cohortLock` ALONGSIDE the existing modelled
  `peerBenchmark` (never replacing it), and both are null unless the requesting tenant is opted
  in and its segment is eligible. `cohortBenchmark` is the verified distribution (p25/p50/p75,
  sampleCount, noised) with the requester's OWN self position; `cohortLock` is the honest
  below-k lock with the live count of opted-in peers in the same normalized segment. Neither
  ever returns a contributor list, a peer id, or a peer value.
- Owner-only (`/api/benchmarks`, behind `requireAuth` and `requireOwner`):
  `POST /recompute` (trigger), `GET /events` (the identity-free audit history), and
  `GET /status` (provider cadence, last recompute, the configured `minCohort` and `noiseBand`;
  never a tenant id or a raw value).

Portal:

- `types.ts` gains `CohortMetric`, `CohortBenchmark`, `CohortLock`, and the consent
  `BenchmarkConsentEvent`/state types, and `TenantLayerDetail` is extended with
  `cohortBenchmark`/`cohortLock`.
- `BenchmarkHero` renders the verified-cohort distribution band (p25/p50/p75 with the self
  marker, the sample count, a "Verified cohort" pill, and the noised "privacy protected" note),
  shows the `CohortLockView` honest lock below k, and KEEPS the modelled `peerBenchmark` and the
  tiles fallback so the two bases are never conflated.
- A new default-off `BenchmarkConsent` toggle reflects the persisted state and flips only after
  the server confirms; a client-viewer sees it read-only. It is wired into the layer page only
  for the benchmark variant archetype.
- `tenantApi.ts` gains `fetchBenchmarkConsent`/`setBenchmarkConsent` with typed outcomes.

## Acceptance evidence

- No tenant identity in the published benchmark path: proven by the schema (no tenant column on
  `benchmark_cohorts` or `benchmark_stats`) and by the integration tests asserting that a
  recompute over opted-in fixtures writes cohort and stat rows with no tenant reference and no
  raw contributor value.
- Opt-in unlocks and opt-out removes: the benchmark integration suite proves an opted-in tenant
  in an eligible cohort receives a `cohortBenchmark`, and that withdrawing consent removes its
  contribution and returns it to the locked or null state.
- The k floor suppresses: a cohort below `minCohort` publishes no stat and the requesting tenant
  receives a `cohortLock`, never a fabricated distribution.
- Bounded noise stays honest: `benchmarkMath` unit tests assert the noise is bounded, the
  `p25 <= p50 <= p75` ordering invariant always holds, and the row is flagged `noised`.
- Unreadable tenants are skipped, not fatal: a revoked or missing key is caught per tenant,
  counted in `skipped_tenant_count`, and the run completes.
- Owner-only fencing and consent logging: the route tests prove `/api/benchmarks/*` is
  owner-only, the consent routes are tenant-access with a client-viewer 403, and a consent
  change writes exactly one audit row.
- Portal data layer: `tenantApi.test.ts` (now 23 tests, +5) covers the consent fetch/set typed
  outcomes including the read-only and error branches.

## Verification

- Typecheck green across all workspace projects (exit 0).
- Build green (exit 0).
- Full suite green at 627 tests: api-server 315 across 37 files (the new `benchmarkMath` unit
  tests and the benchmark integration tests), portal 177 across 14 files (the extended
  `tenantApi.test.ts`), cortex 84, connectors 29, edge-agent 10, db 8, scripts 4.
- Long-dash sweep zero on BOTH sides: the source guard (`findLongDashViolations(repoRoot)`
  returns an empty array) plus a fresh `rg` over the authored tree returns zero matches, and a
  database-wide cast over every public text and jsonb column (118 columns, including the new
  benchmark tables and `benchmark_consent_events.reason`) reports zero hits.
- Zero new npm dependencies.

## Logged drift and deviations

- Benchmark stats and cohorts contain NO raw data and NO tenant identity. This is the defining
  privacy guarantee of the phase and is enforced structurally: `benchmark_cohorts` and
  `benchmark_stats` have no tenant column, the recompute pools only in-memory scalar math, and
  the published rows carry counts and percentiles only. The consent audit
  (`benchmark_consent_events`) is the ONLY tenant-scoped audit path in the feature; the
  recompute audit (`benchmark_events`) is identity-free.
- Bounded noise for small cohorts is disclosed, not fabricated. A cohort in `[k, noiseBand)` is
  perturbed within a fraction of its IQR and clamped to preserve `p25 <= p50 <= p75`, flagged
  `noised = true`, and surfaced as "privacy protected". It is a labelled privacy control over a
  real distribution, never an invented number.
- Stale-config hardening (non-blocking, from the architect `evaluate_task` review). The live
  `buildLayerCohort` read trusts the most recent `benchmark_stats` rows; it does not currently
  re-filter them against the CURRENT `getBenchmarkMinCohort()`/noise configuration, so if an
  operator tightens `BENCHMARK_MIN_COHORT` between recomputes, a stat row computed under the
  looser floor could be served until the next recompute supersedes it. This is logged drift,
  not built, to avoid expanding the milestone's scope: the recompute always re-applies the
  current config, the window is bounded by the recompute cadence, and a stricter floor only
  ever makes the next recompute MORE conservative, never less. A future hardening can re-gate at
  read time or force a recompute on a config change.
- The modelled `peerBenchmark` is kept alongside the verified `cohortBenchmark`, never replaced.
  The two bases are visually and structurally distinct (a "Verified cohort" pill versus the
  modelled tiles), so a modelled estimate is never presented as a verified cohort fact.

## Gate

Phase X passed its architect `evaluate_task` review (PASS on the implementation; the only
non-blocking item is the stale-config hardening logged above, and the architect confirmed no
peer identity or raw value leak in the cohort path). The drift index, the rollup, and the V2
build report are updated to "A through X". Phase X is a SECURITY MILESTONE, so per the protocol
this is a HARD STOP for owner review: execution does not auto-advance into Phase Y.
