# Phase N: cost and token observability

Phase id: N. Name: Cost and Token Observability. Milestone: no, but gated (a per-phase
hard stop for owner review before the next phase).

Phase N opens Stage 3 (operations and economics). It records one honest `model_usage`
row per real model call, prices each row from the real token counts at configured
list-price rates, exposes an owner-only Spend console over that ledger, and enforces
env-backed monthly budget caps (a global ceiling and a per-tenant ceiling) with an alert
at a configurable fraction of either. The single hard rule is that nothing in the ledger
is fabricated: a dollar figure exists only because a real provider call billed real
tokens, and a call that made no request bills nothing. This phase added zero npm
dependencies and contains no em-dash or en-dash.

## What Phase N built

- A new `model_usage` ledger table: one row per real billed model call, with the tenant
  (nullable, set null on tenant delete so the cost history survives), the run id
  (nullable, no foreign key so a profile call that predates any run still records), the
  stage, the layer key (nullable), the seat, the model string the call reported, the
  token buckets (input, output, cache read, cache creation, all not-null defaulting to
  zero), the web-search call count, the computed `costUsd` as `numeric(12,6)`, and the
  created-at instant. Indexed on tenant and on created-at for the monthly and per-tenant
  rollups.
- A cortex pricing module (`lib/cortex/src/pricing.ts`): the only place token counts
  become dollars. Rates are keyed by the three cortex seats, never by a literal model
  string, so the no-model-literal config invariant holds; a reported model string is
  resolved back to its seat through `SEATS`. A self-hosted or unrecognised model prices
  at the zero rate because it incurs no external per-token charge.
- A best-effort usage writer (`artifacts/api-server/src/lib/pipeline/usage.ts`): computes
  the cost through `costUsdForUsage` and inserts one row, wrapped so a ledger-write
  failure logs and is swallowed rather than aborting a layer (cost tracking must never
  break the diagnosis it accounts for). It records a row only when the call was really
  billed (see the billed-signal section below).
- A budget governor (`artifacts/api-server/src/lib/pipeline/budget.ts`): env-backed caps,
  a real summed-spend reader over the ledger, and `assertSeedWithinBudget`, which refuses
  a new seed once a ceiling is reached and warns at the alert threshold. Enforced in the
  seed and refresh routes with a clear typed HTTP error, and again defensively inside the
  seed path before any model spend.
- An owner-only Spend console: a `GET /api/spend/summary` route behind owner auth that
  returns the month, the totals, and the breakdowns by tenant, seat, stage, run, and day,
  plus the caps and threshold; and a portal `/spend` page that renders it with honest
  loading, empty, and error states.

## The billed signal: why the ledger never fabricates a row

The core honesty problem this phase had to solve is that a model call can fail in two
very different ways, and only one of them costs money. A call can fail because no request
was ever made (no in-boundary model is configured, a provider integration has no env, or
the transport failed before any response), in which case there is no token cost and the
ledger must record nothing. Or a call can reach the provider, bill real tokens on a 200
response, and only then fail our own schema validation, in which case the money was spent
and the ledger must record it at the real cost even though the stage failed.

An explicit `billed` flag now travels on the stage telemetry to distinguish the two. It
means a real token-billed provider response occurred (a success, or a validation failure
that still consumed tokens). `recordModelUsage` records a row only when `billed` is true
and a model is present; a no-call failure carries `billed: false` and produces no row, so
the ledger can never contain a fabricated zero-cost line for a call that never happened.
Each client also accumulates token usage across its two-attempt corrective retry, so a
billed-then-retried attempt is counted once with the summed tokens of every billed
attempt, never dropped and never double-counted.

## Acceptance checklist

1. One honest row per real call. Met. The orchestrator is the sole side-effect owner and
   the only place usage is tapped: `executeStage` after `run()` on both the ok and the
   error path, `executeEnrichment` as a single row (never the batched folded peers and
   supplements), and the profile build after the tenant is ensured (run id and layer key
   null). Resume paths return before the tap, so a resumed run records no duplicate. A
   call that made no request carries `billed: false` and records nothing.
2. Cost is computed from real tokens at configured rates, never fabricated. Met.
   `costUsdForUsage` prices each token bucket at its seat rate plus the web-search calls
   and rounds to the six decimals of the ledger column; missing counts are treated as
   zero, never guessed. The rates are published list-price defaults that the operator
   must verify against their own contract, stated as such in the module and the console.
3. No model-string literal enters source. Met. Pricing resolves a model to its rates by
   scanning `SEATS`, and the config invariant test still passes; the only model
   identifiers in source remain those in `config.ts`.
4. The local or unknown model prices at zero. Met. `ratesForModel` returns the zero
   `LOCAL_RATES` for any model that does not match a configured seat, which is an honest
   accounting of an in-boundary seat that incurs no external charge, not a silent
   fallback that hides a real cost.
5. Budget caps are env-backed and enforced. Met. `budgetCaps` reads
   `SPEND_GLOBAL_MONTHLY_CAP_USD` (default 1000), `SPEND_TENANT_MONTHLY_CAP_USD` (default
   50), and `SPEND_ALERT_THRESHOLD` (default 0.8); `assertSeedWithinBudget` refuses a new
   seed once a ceiling is reached and warns between the threshold and the ceiling. The
   owner-only `priorityOverride` bypasses the global ceiling only; the per-tenant ceiling
   is always enforced.
6. Enforcement is both at the route and defence-in-depth. Met. The seed and refresh
   routes assert the budget and return a clear typed HTTP error on a breach, and the seed
   path asserts again before `runLayers` (marking the tenant failed on a breach) so a
   non-route caller cannot spend past a ceiling.
7. The Spend summary reconciles to the ledger. Met. The integration test proves the
   owner summary totals equal a direct `SUM` over `model_usage`, a member is refused with
   403, and an unauthenticated request is 401.
8. Honest UI states. Met. The Spend page renders distinct loading, empty (no spend yet),
   error, and ready states, and a 401 maps to its own unauthorized state rather than an
   empty zero.
9. The long-dash sweep returns zero. Met on both sides: the source guard over lib,
   artifacts, docs, and scripts is zero, and a per-row cast over the `model_usage` ledger
   and the run telemetry that now carries the billed flag is zero.

## New tables, routes, and env

- Table: `model_usage` (the cost ledger described above).
- Route: owner-only `GET /api/spend/summary`, mounted behind the existing auth and owner
  guards.
- Env: `SPEND_GLOBAL_MONTHLY_CAP_USD`, `SPEND_TENANT_MONTHLY_CAP_USD`,
  `SPEND_ALERT_THRESHOLD`, all optional with the documented defaults; the pricing rates
  are code defaults that the operator must verify, not env.

## Logged drift and deviations

- The pricing rates are published list-price defaults, not the operator's negotiated
  contract. They are documented as verify-before-trust in the pricing module and surfaced
  honestly in the console; volume or negotiated pricing will differ. This is a deliberate
  honest default, not a measurement.
- Cost tracking is best-effort relative to producing the diagnosis. A ledger-write
  failure is logged and swallowed so it never aborts a layer, which means a write error
  could in principle under-count rather than fail the seed. The trade is deliberate: the
  diagnosis is the product, and the cost row is an account of it that must not break it.
- The budget alert at the threshold is a logged warning this phase; the notifier that
  consumes the same signal from the spend API is later-phase work and is not built here.
- The monthly window is calendar-month in UTC; a new month resets the running total
  honestly. Tenants and time zones do not shift the window.

## Verification

- Typecheck and build are green across the workspace (exit 0 on both).
- The full suite is green at 417 tests (api-server 139, portal 149, cortex 80,
  connectors 27, edge-agent 10, db 8, scripts 4). New this phase: the cortex pricing math
  and the billed-token accounting tests, the api-server budget and spend-summary
  integration tests, and the portal spend-api outcome tests.
- The spend summary integration test reconciles the owner totals to a direct `SUM` over
  the ledger and proves the 403 and 401 refusals; the usage tests prove the one-row
  invariant, that a no-call failure records nothing, that a billed-but-failed call records
  at the real cost, and that the corrective retry sums tokens rather than dropping the
  first attempt.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, and
  scripts, and a per-row cast over the `model_usage` ledger and the run telemetry.
- Zero new npm dependencies.

## Remediation iterations

- The architect was consulted up front with `responsibility: plan` to shape the phase,
  and its design was followed: price by seat (no model literals), tap usage only in the
  orchestrator as the sole side-effect owner, record one row per real call with resume
  paths recording nothing, and enforce the caps both at the route and defensively in the
  seed path.
- A first `evaluate_task` review FAILED with three findings, all now fixed and
  re-reviewed to a PASS. (1) A no-call failure was recording a fabricated zero-cost row
  (an unconfigured in-boundary Lens, and external seats with no provider env, returned
  failure telemetry that still carried a model). The fix is the explicit `billed` signal:
  `recordModelUsage` records only when `billed && model`, and a no-call failure carries
  `billed: false`. (2) A billed-but-failed or retried call was dropping its tokens (a
  validation failure returned without its usage, and the corrective retry recorded only
  the final attempt; a profile failure threw before the usage tap). The fix carries the
  real tokens on a billed failure, sums the tokens of every billed attempt across the
  retry in all three clients, and records the billed profile failure (tenant id null)
  before re-throwing. (3) The connected-tenant seed path called `runLayers` without the
  budget assertion. The fix adds `assertSeedWithinBudget` before `runLayers` there too,
  marking the tenant failed on a breach. The re-review returned a PASS with no remaining
  severe findings.

## Gate

Phase N is gated. It is the first phase of Stage 3. Execution pauses here for owner
review before the next phase. Do not auto-advance.
