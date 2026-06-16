# Phase AJ: the Brier-scored calibration ledger

Phase id: AJ. Name: the Brier-scored calibration ledger. Milestone: yes (a hard stop for owner
review; the build PAUSES at the AJ gate and does NOT auto-advance to Phase AK).

Phase AJ supersedes Phase W's loose calibration (a raw hits-over-resolved count) with a proper
probabilistic scoring rule. The real Evaluator seat now states a likelihood for each binary,
resolvable claim it makes; that probability is stored once at seed time and, when the claim later
comes true or false, scored with the Brier score (the mean squared error of a probabilistic
forecast: 0 is perfect, 1 is perfectly wrong, and the trivial always-0.5 forecaster scores exactly
0.25). The calibration surface reads every aggregate against that 0.25 baseline, labels a thin
sample honestly, and shows the resolved ledger with misses always included. Zero new npm
dependencies; ASCII hyphen only in source and in data; no fabricated telemetry, health, or output;
no literal model ids (the Evaluator stays a SEAT); and crucially no verdict-to-probability mapping,
no fallback probabilities, and no title-based action linking.

## The schema: one forecast ledger for every prediction kind

`lib/db/src/schema/forecasts.ts` adds one `forecasts` table (the only schema change; the base-table
count goes from 39 to 40). One row is one probabilistic forecast that can later resolve true or
false. `forecast_kind` enumerates the five kinds, so a single table covers them all without a kind
column per feature: `action_outcome`, `risk_occurrence`, `anomaly_materiality`, `finding_survival`,
and `confounder_verdict` (the adversarial seat's own predictions about explanations, so the
Confounder carries published accuracy too).

The honesty boundary is in the column nullability. `probability` (numeric(5,4), in [0,1]) is set at
creation from the real Evaluator output and never from a verdict string or a reflexive default.
`outcome` (integer 0 or 1), `resolvedAt`, `brierScore`, and `resolutionBasis` are ALL null until the
forecast actually resolves: an unresolved forecast carries no score, so a figure is computed from
persisted state or it is not shown. `resolutionBasis` is its own enum (`measured`, `modelled`,
`owner`) so the surface can be honest about how a resolution was grounded.

The foreign keys encode the lifecycle: `tenantId` on delete cascade (a forecast belongs to its
tenant), `layerKey` on delete restrict (the layer registry is the source of truth and must not lose
a referenced key), `committedActionId` on delete set null (the link to the action it predicts),
`outcomeMeasurementId` on delete set null (the measurement that resolved it), and `resolvedBy` on
delete set null (the owner who adjudicated it). The row outlives the operator who graded it, so the
track record survives a user delete, mirroring the audit tables. `madeAt` and `resolveBy` (the
deadline, made-at plus the horizon) bracket the forecast in time; `sourcePath`, `statement`, and
`subjectSeat` carry the anchor, the human-readable claim, and the seat that owns it. Indexes cover
the tenant, the (tenant, kind), the committed action, and the resolved-at read paths.

## The Brier math, pure and hand-pinned

`artifacts/api-server/src/lib/calibration/brierMath.ts` is pure (no database, no I/O), so every
figure on the calibration surface is a deterministic computation a hand-worked unit test can pin
down:

- `brierScore(p, o) = (p - o)^2`, with the probability clamped to [0,1] and rounded to six places.
- `naiveBaseline()` and `NAIVE_BASELINE` are exactly 0.25, the always-0.5 forecaster's score, the
  fixed reference line every aggregate is read against.
- `aggregateBrier(points)` means the per-forecast scores and returns `{ meanBrier: null, n: 0 }` for
  an empty set, never a fabricated zero.
- `aggregateBy(points, keyFn)` produces the per-layer, per-kind, and per-seat breakdowns in one pass.
- `calibrationCurve(points)` buckets the stated probabilities into ten bands of 0.1 and, for each
  non-empty band, reports the mean stated probability against the observed frequency; an empty band
  has a null point, never a plotted zero.
- `labelSample(n, threshold)` returns `established` once the resolved count clears the threshold and
  otherwise an honest "early, n resolved" so a thin sample never reads as a proven track record.
- `applyConfidenceCalibration(raw, { brier, n, threshold })` is downward only: it is applied only
  once the sample clears the threshold AND the layer's Brier is worse than 0.25, it shrinks the
  confidence toward the neutral floor of 50 by at most 10 points, and it never inflates a pill and
  never crosses the floor.

`config.ts` is the one documented place for the honesty thresholds so they cannot be quietly tuned
to flatter the score: `CALIBRATION_MIN_RESOLVED_PER_SEGMENT` defaults to 10 (overridable by env),
the band size is 0.1, the maximum confidence penalty is 10 points, and the neutral floor is 50.

## Cortex: forecasts emitted by the real Evaluator

`lib/cortex/src/schemas/stages.ts` extends the score stage output with an optional `forecasts[]`,
each carrying `source_path`, `kind`, `statement`, `probability` (0 to 1), `horizon_days`, and
`subject_seat`. `lib/cortex/src/stages/runners.ts` extends the score prompt to ask the real
Evaluator for genuine likelihoods across the full range (not a reflexive 0.8), only for claims that
are binary and resolvable within a horizon, and to derive `confounder_verdict` forecasts from the
CONFOUNDER FINDINGS with `subject_seat=Confounder`. There is no synthesis of a probability from a
verdict string anywhere; the number is the model's own stated likelihood or there is no forecast.
The score stage stays the only writer of stored `verified|modelled` content, and the seat config
invariant holds (the Evaluator is a SEAT, no model literal enters source).

## The orchestrator persists at seed time

`artifacts/api-server/src/lib/pipeline/orchestrator.ts` persists the emitted forecasts only after
the REAL `score` stage succeeds, computing each row's `resolveBy` deadline as `madeAt` plus the
forecast's `horizon_days`. The orchestrator remains the sole side-effect owner; the cortex stays
pure. A run that emits no forecasts writes none.

## Resolution: the single honest writer

`artifacts/api-server/src/lib/calibration/forecastResolution.ts` is the only place a forecast's
outcome, Brier score, and basis are written, and it resolves a forecast exactly one of two honest
ways:

- Automatically, from a real outcome measurement on the committed action the forecast was linked to.
  `linkForecastToCommittedAction` binds an `action_outcome` forecast by an EXPLICIT reference only,
  the forecast's own id or its `(layerKey, sourcePath)` anchor; titles are never matched, so a
  renamed action or a coincidental title collision can never bind the wrong prediction. Only an
  unlinked, unresolved forecast is eligible, and the bind is guarded by `isNull(committedActionId)`.
  `resolveForecastsForMeasurement` then resolves the linked, still-open forecasts only on a TERMINAL
  measurement status (realized resolves to 1, missed to 0; a pending or on_track measurement resolves
  nothing and leaves the forecast open). The Brier score is computed from the stored probability and
  the realised outcome, and the basis mirrors the measurement's own basis, so a forecast resolved
  from a modelled estimate is recorded `modelled`, never presented as measured fact.
- By explicit owner adjudication. `resolveForecastByOwner` takes the realised outcome from the owner
  and computes the Brier score server-side from the stored probability (never accepts a score from
  the client). Only an unresolved forecast can be adjudicated, and the update is guarded by the same
  `isNull(resolvedAt)` predicate, so two concurrent adjudications cannot both win (the loser gets
  `already_resolved`).

## The calibration route

`artifacts/api-server/src/routes/calibration.ts` mounts behind `requireAuth`. `GET /api/calibration`
returns a calibration summary: the headline Brier with its sample label and whether it beats the
0.25 baseline, the baseline itself, the ten-band curve, the per-layer, per-kind, and per-seat
breakdowns each with a sample label, the resolved and open counts, and the resolved-forecast ledger
(most recent first, capped at 200, misses always included). Authorization is by scope: with a
`tenantId` the summary is scoped to that tenant and allowed for any seat that can reach it (a 403
otherwise, via `resolveAccessibleTenantIds`); without one it is the system-wide track record and is
owner-only (a 403 for a non-owner). `POST /api/calibration/forecasts/:id/resolve` is owner-only,
validates the body (outcome 0 or 1, an optional note that is dash-stripped), and maps the resolution
result to 200, 404 (`not_found`), or 409 (`already_resolved`).

`artifacts/api-server/src/lib/calibration/layerConfidence.ts` exposes
`computeLayerConfidenceAdvisory`, the display-only path for a single layer: it reads that layer's own
resolved forecasts, computes their Brier, and returns the disciplined confidence alongside the raw
value and the evidence (resolved count, layer Brier, sample label). It never overwrites the raw
Evaluator confidence; the adjustment is advisory and is applied by the surface only once the layer
clears the resolved-sample threshold.

## Portal

`artifacts/portal/src/lib/calibrationApi.ts` is a framework-free data layer mirroring `spendApi`: a
pure `fetchCalibrationSummary(tenantId?)` that maps a 401 to `{ unauthorized: true }` so the caller
can log out, validates that the payload carries a headline and a scope, and returns a typed outcome.
`artifacts/portal/src/components/pages/CalibrationPage.tsx` renders the headline Brier with a
plain-English explainer, a no-dependency SVG-and-div calibration curve (the stated probability
against the observed frequency, with the perfect-calibration diagonal), the per-layer, per-kind, and
per-seat tables, the resolved count, honest sample labels, and the visible resolved ledger with
misses included. The four data states are distinct and honest: a shimmer while loading, a plain
empty fact before the first resolution, a loud error, and the real figures once a forecast has
resolved. An empty set is never rendered as a fabricated zero (a missing figure shows a dash). The
page is registered in the router and the Shell.

## Tests

- `artifacts/api-server/src/lib/calibration/brierMath.test.ts` (20). Hand-worked Brier math:
  `(0.8 - 1)^2 = 0.04`, `(0.8 - 0)^2 = 0.64`, the coin flip at 0.25 either way, the perfect extremes
  and out-of-range clamping, the empty-set null mean, the mean of per-forecast scores computed from
  probability and outcome directly (not a stored score), the per-segment aggregation, the
  ten-band curve with null empty bands, the sample labelling at the threshold, and the
  downward-only, threshold-gated, never-inflating confidence calibration.
- `artifacts/api-server/src/routes/calibration.integration.test.ts` (9). End to end over real
  Postgres: a forecast persisted from the real Evaluator output shape; an owner adjudication
  computing the Brier score server-side; a member forbidden from the resolve route (403) and a second
  adjudication of the same forecast 409ing; a measurement auto-resolving a linked forecast on a
  terminal status while a pending measurement leaves it open; a deliberately wrong forecast worsening
  the aggregate; misses present in the ledger; the owner system-wide versus member-forbidden scope
  split; and the unauthenticated 401. Rows are namespaced by a run id and removed afterward.
- `artifacts/portal/src/lib/calibrationApi.test.ts` (6). The client outcomes: ready with the summary
  on the system-wide route by default, the tenant-scoped query string, unauthorized on a 401, error
  on a non-ok status, error on a thrown fetch, and error on a malformed payload.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 923 tests (api-server 522 across 60 files, portal 240 across 19 files, cortex
  110 across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4),
  up 35 from Phase AI's 888. The new tests are api-server `brierMath` (20) and
  `calibration.integration` (9), plus portal `calibrationApi` (6).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this
  Phase AJ Markdown, and a fresh database-wide cast over all 150 public text and jsonb columns across
  the 40 base tables (the `forecasts` table is the one added) reports zero hits.
- Zero new npm dependencies (the workspace packages and the already-present `drizzle-orm` and `zod`,
  plus the shared cortex `stripDashes`).

## Honest marking

What is TEST-PROVEN here: the Brier math against hand-worked numbers; the forecast persistence from
the real Evaluator output shape; the owner adjudication computing the score server-side from the
stored probability; the measurement-driven auto-resolution (terminal resolves, non-terminal leaves
open) with the basis carried from the measurement; the explicit, id-or-anchor action linking; a
deliberately wrong forecast worsening the aggregate; misses present in the ledger; the scope
authorization (owner system-wide versus member 403, tenant scope, the 409 double-resolve, and the
401); and the portal client outcomes.

What is SOURCE-REVIEWED rather than test-proven (the accepted LOWs): the score prompt that elicits
the genuine likelihoods runs only inside a real paid Evaluator call, which the suite deliberately
does not run, so the PROMPT wording is source-reviewed while the score OUTPUT SCHEMA that carries
`forecasts[]` and the orchestrator PERSISTENCE of emitted forecasts ARE proven (the integration test
drives the real output shape through the persist path); and the `CalibrationPage.tsx` React rendering
is source-reviewed, while the `calibrationApi` client it calls is unit-tested and the route behind it
is integration-tested. These mirror the earlier real-model-call and portal-rendering LOWs (AC, AE,
AF, AG).

Nothing is fabricated: an unresolved forecast shows no outcome and no score, an empty segment shows a
dash rather than a zero, a thin sample is labelled "early", and the ledger is a track record that
includes its misses.

## Logged drift and deviations

- The Evaluator's forecast probabilities are generated by a real paid model call at seed time that
  the suite does not run (AJ). The score output schema carrying `forecasts[]` and the persistence of
  emitted forecasts ARE test-proven through the real output shape; only the prompt that elicits the
  likelihoods is source-reviewed. Accepted as logged drift, mirroring the AC challenge re-reason and
  AF sovereign real-endpoint items; a future injected-Evaluator test or a real seed can close it.
- No dedicated portal unit test for the calibration page (AJ). `CalibrationPage.tsx` is
  source-reviewed; the `calibrationApi` client behind it IS unit-tested and the `/api/calibration`
  route IS integration-tested. Accepted as logged drift, mirroring the AE, AF, and AG portal items; a
  future lightweight portal test can close it.
- A forecast auto-resolved from a modelled (non-measured) outcome measurement is recorded with basis
  `modelled`, not `measured` (AJ). This is by design and surfaced honestly on the ledger, so a
  resolution grounded in a modelled estimate is never presented as measured ground truth; noted here
  for the reader, not a defect.

## Gate

Phase AJ passed its architect `evaluate_task` review (PASS), which assessed the Brier math and
aggregation, the honesty boundary (no probability is ever synthesised from a verdict string or
defaulted), the resolution path (no double-resolve, owner-only adjudication, explicit id-or-anchor
action linking rather than title matching), and the calibration route authorization, and confirmed
the hard constraints hold (zero new dependencies, ASCII hyphen only in source and data, no literal
model ids). The drift index, the rollup, and the V2 build report are updated to "A through AJ". Phase
AJ is a MILESTONE hard stop: it supersedes Phase W's loose calibration with a proper probabilistic
scoring rule, and the build now PAUSES at the AJ gate for owner review and does NOT auto-advance to
Phase AK.
