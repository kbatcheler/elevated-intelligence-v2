# Phase W: the outcome loop and value realized (opens Stage 4)

Phase id: W. Name: Outcome Loop and Value Realized. Milestone: no (gated; the opening phase of
Stage 4, Differentiation and Moat, run back to back with U and V under owner authorization). This
phase turns the track record from a list of intentions into a graded history: it captures a numeric
prediction at commit time, records real measured outcomes against it, sums value identified versus
value realized, and grades the system's accuracy with a simple, honest calibration score. It added
zero npm dependencies and contains no em-dash or en-dash in source or in data.

Adaptation note (binding, from the run plan): W is unchanged from its master prompt, but its loose
calibration score is later superseded by the Brier-scored ledger in milestone AJ, so the calibration
here is kept deliberately simple and honest and is NOT over-built. One surface adaptation: V2 has no
standalone "business-performance layer hero", so the value counter and the calibration badge are
rendered by elevating the existing Track Record surface (the actions page) rather than minting a new
hero, satisfying the "elevate, do not replace" instruction directly.

## What was built

Schema (pushed to dev Postgres with `pnpm --filter @workspace/db push`):

- `committed_actions` is extended with three commit-time snapshot columns:
  `predicted_value_usd` (`numeric(14,2)`), `baseline_metric` (`numeric`), and `baseline_at`
  (`timestamptz`). All three are nullable: an action with no parseable dollar figure has no numeric
  prediction, and an outside-in action has no measured baseline. Honest absence, never a fabricated
  zero.
- A new `outcome_measurements` table: `id`, `actionId` (FK to `committed_actions`, `onDelete:
  cascade`, indexed), `measuredAt` (`timestamptz`, defaults now, indexed), `actualMetric`
  (`numeric`), `realizedValueUsd` (`numeric(14,2)`), `varianceVsPrediction` (`numeric(14,2)`),
  `basis`, `status`, `note`, `recordedBy` (FK to `users`, `onDelete: set null` so the graded history
  outlives the operator, mirroring the audit tables), and `createdAt`. Two new pg enums:
  `outcome_measurement_basis` (`measured`, `modelled`) and `outcome_measurement_status` (`pending`,
  `on_track`, `realized`, `missed`).

Pure modules (unit-tested, no database or request needed):

- `artifacts/api-server/src/lib/outcomes/predictedValue.ts`: `parsePredictedValueUsd` reads a real
  dollar figure out of the action's `predictedImpact` string and returns null when there is none. It
  is deliberately conservative: an amount must be anchored by a `$` or a `USD` token, so a bare
  percentage, a margin-point figure, or prose yields null rather than an invented number. It honors
  scale units (k, m/mm/million, b/bn/billion) and rounds to the two decimals of the column.
- `artifacts/api-server/src/lib/outcomes/outcomeMath.ts`: the pure math behind the counter and the
  badge. `toNum` parses a database numeric string to a finite number or null (never NaN);
  `deriveMeasurementStatus` grades from the numbers alone and returns `missed` ONLY on a final
  measurement (an in-flight action below its prediction reads `on_track`, never a spurious miss);
  `computeVariance` is realized minus predicted, or null when either side is absent;
  `latestMeasurementPerAction` keeps the most recent measurement per action so a summed value never
  double-counts a re-measured action; `computeCalibration` is hits over resolved (realized or missed)
  and returns a null score on an empty record rather than a fabricated 100 percent;
  `computeOutcomeSummary` sums `predictedValueUsd` over committed non-dismissed actions
  (value identified) and `realizedValueUsd` over the latest measurement per action (value realized).

Routes (`artifacts/api-server/src/routes/tenants.ts`):

- The action-commit flow now snapshots `predictedValueUsd` (parsed from the real action's
  `predictedImpact`, else null) and, when the caller names a real scalar derived signal on commit
  (connected mode), snapshots `baselineMetric` and `baselineAt` from that single signal reading; in
  outside-in mode both stay null.
- `POST /api/tenants/:id/actions/:actionId/measurements` (provider-only behind `requireTenantAccess`,
  the action re-checked by tenant and action id so a measurement can never cross tenants): `basis` is
  `measured` ONLY when a real finite scalar derived signal is found for the named key; a missing or
  non-scalar signal returns `400 signal_not_found` rather than silently degrading to `modelled`. An
  operator estimate with no signal is `modelled`. `status` and `varianceVsPrediction` are derived
  server-side from the numbers, never accepted raw from the client.
- `GET .../measurements` lists the measurements for an action; `GET /api/tenants/:id/outcomes`
  returns the computed summary (value identified, value realized, calibration) plus the measurements.

Portal (`artifacts/portal`):

- `types.ts` is extended (`CommittedAction` plus `OutcomeMeasurement`, `Calibration`,
  `OutcomeSummary`, `TenantOutcomes`); a new framework-free `lib/outcomeApi.ts` mirrors the other
  data-layer modules with typed outcomes; `formatUsd` is added to `components/primitives/format.ts`;
  and the Track Record (`ActionsPage.tsx`) is elevated with a value-identified-versus-realized
  counter, a calibration trust badge with misses surfaced, and per-action realized value, variance,
  and basis, elevating the existing surface rather than replacing it.

## Acceptance evidence

- Committing snapshots a prediction baseline: proven by the outcome-loop integration tests in
  `routes/tenants.integration.test.ts` (predicted value parsed from a currency impact and stored;
  a non-currency impact stores null; a named scalar signal snapshots the baseline; outside-in leaves
  it null).
- A measurement records realized value with the correct basis: proven in the same suite (a real
  scalar signal yields `basis=measured`; a missing or non-scalar signal returns `400
  signal_not_found`; an estimate with no signal is `modelled`; status and variance are server-derived;
  provider-only, and a cross-tenant action id is refused).
- The counter reconciles: `outcomeMath.test.ts` asserts the summary equals a direct sum, including
  the latest-measurement-per-action de-duplication, and the integration test reconciles the route's
  summary against the persisted rows.
- The calibration score computes and updates as outcomes land: `outcomeMath.test.ts` covers the
  grading transitions (pending, on_track, realized, missed, final-only miss) and the null-on-empty
  score; `predictedValue.test.ts` covers the parser including the conservative null cases.
- Portal data layer: `lib/outcomeApi.test.ts` (8 tests) covers the typed outcomes and the
  status-to-error and 401 branches.

## Verification

- Typecheck green across all workspace projects (exit 0).
- Build green (exit 0): portal 1743 modules transformed, api-server bundled to `dist/index.mjs`.
- Full suite green at 593 tests: api-server 286 across 34 files (the new
  `lib/outcomes/predictedValue.test.ts` and `lib/outcomes/outcomeMath.test.ts`, plus the outcome-loop
  integration tests in `routes/tenants.integration.test.ts`), portal 172 across 14 files (the new
  `lib/outcomeApi.test.ts`), cortex 84, connectors 29, edge-agent 10, db 8, scripts 4.
- Long-dash sweep zero on both sides: the source guard (`scripts/emDashGuard.test.ts`) is green over
  authored source and a fresh `rg` over all files including hidden returns zero matches; a fresh
  database-wide cast over every public text and jsonb column (108 columns, including the new
  `outcome_measurements.note`) reports `TOTAL DASH HITS 0`.
- Zero new npm dependencies.

## Logged drift and deviations

- No business-performance hero surface in V2; the value counter and the calibration badge elevate the
  existing Track Record (actions page) instead. This satisfies "elevate, do not replace" directly and
  avoids inventing a surface the V1 reference did not have.
- Calibration is deliberately simple (hits over resolved), not Brier-scored. This is intentional per
  the adaptation guide: milestone AJ supersedes it with a Brier-scored ledger, so W only has to be
  honest, not clever. An empty record returns a null score, never a fabricated 100 percent.
- `predictedValueUsd` is derived from a currency-anchored impact only. A percentage, a margin-point
  figure, or prose has no numeric prediction (null), because coercing a non-currency figure into a
  dollar value would fabricate a number. The same honesty applies to the baseline: it is snapshotted
  only from a single real scalar derived signal in connected mode, null otherwise.
- `basis=measured` is reserved for an outcome grounded in a real derived signal reading; a missing or
  non-scalar signal is a loud `400 signal_not_found`, never a silent downgrade to `modelled`, so a
  modelled estimate is never presented as measured fact.
- `status=missed` is only ever set on a final measurement, so an in-flight action below its prediction
  is never spuriously graded as a miss.

## Gate

Phase W passed its architect `evaluate_task` review (PASS on the implementation; the only flagged gap
was these drift documents, now written). The drift index, the rollup, and the V2 build report are
updated to "A through W". Phase W is the last phase before milestone X (benchmarking), so per the run
plan this is a HARD STOP for owner review: execution does not auto-advance into Phase X.
