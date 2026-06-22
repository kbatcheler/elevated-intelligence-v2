# Phase AQ: Outcome Loop Closure (the proof the product is right)

## Objective

The schema already holds decision records, forecasts, Brier scoring, and outcome
measurements, but no single loop is demonstrably closed. The product becomes
undeniable the moment it can show one real recommendation, committed as a
decision, resolved against a measured outcome, with the calibration score moving.
This phase closes that loop in the backend and surfaces it on exactly one new
portal page, so a buyer can watch a prediction be made, committed, and then proven
right or wrong over time.

## Ownership boundary

This phase owns `artifacts/api-server/src/lib/outcomes/**`,
`artifacts/api-server/src/lib/calibration/**`, the outcome and calibration routes,
`artifacts/api-server/src/scripts/seedLive.ts`, and EXACTLY ONE new portal page
(for example `OutcomeLoopPage.tsx`) plus its single API client file and ONE
appended navigation entry in `TopNav.tsx`. It does not restructure navigation, the
shell, the primitives, or the design tokens; the page is built from the existing
primitives and will be made beautiful by phase AS. It does not touch
`lib/connectors`, `lib/cortex`, or `infra`.

## Invariants (restated)

Never fabricate a score: a forecast's `outcome`, `resolvedAt`, `brierScore`, and
`resolutionBasis` stay null until the forecast actually resolves, so an unresolved
row can never carry an invented score. A figure is computed from persisted state
or it is not shown. The decision record is a recorded human act and always appends
exactly one hash chained provenance entry, bound by its `recommendationHash` so a
later refresh can never silently re-point the audit. ASCII hyphen only. Full suite
green and long dash sweep zero before close.

## Ordered tasks

1. Close the automatic resolution path. An `action_outcome` forecast linked to its
   committed action by an explicit id or anchor reference resolves automatically
   only on a terminal outcome measurement, under the existing unresolved row guard
   that prevents a double resolve. Confirm and test that path, and the owner
   adjudication path computed server side, so a forecast can move from unresolved
   to resolved by a real measurement or a real human adjudication and nothing
   else.
2. Recompute calibration honestly from resolved forecasts only. The Brier and the
   reliability view read resolved rows; unresolved rows are reported as
   outstanding, never folded into the score. A tenant with no resolved forecast
   yet shows an honest empty calibration, not a zero.
3. Extend `seedLive.ts` to stand up one fully closed demonstration loop for the
   demo tenant: a real layer build produces a recommendation, a decision record
   commits it with its provenance entry and recommendation hash, a forecast is
   created from the real Evaluator probability, an outcome measurement resolves it,
   and the calibration score reflects the resolution. Everything in the loop is
   real persisted state produced by the real pipeline, never a hand placed figure.
4. Build the single new page from existing primitives: the recommendation as it
   stood at decision time, the human decision and its provenance reference, the
   forecast probability, the resolution and its basis (measured, modelled, or
   owner), and the Brier contribution, with the four honest data states. Show the
   provenance pill on every figure so a verified resolution and a modelled estimate
   are never confused. Add its API client and append one navigation entry only.
5. Add an integration test that walks the whole loop server side: build,
   recommend, commit, forecast, measure, resolve, recompute, and assert that the
   provenance chain still verifies, the recommendation hash still binds, the score
   moved, and no unresolved row carries a score.

## What you must not do

Do not invent an outcome, a probability, or a Brier score; every value is real
persisted state or it is absent. Do not restructure the navigation, the shell, or
the design tokens; add one page and one nav line and let AS make it sing. Do not
touch connectors, cortex, or infra. Do not collapse the verified versus modelled
distinction anywhere on the page.

## Acceptance gate

One outcome loop is demonstrably closed end to end on the demo tenant, built
entirely from real pipeline state; calibration is recomputed from resolved
forecasts only and is honestly empty before any resolution; the new page shows the
loop with provenance on every figure and honest data states; the loop integration
test passes and the provenance chain still verifies. `typecheck`, `build`, and
`test` green. Long dash sweep zero. Drift records written for phase AQ:
`docs/drift/phase-AQ.md`, the build report appended, the INDEX and rollup advanced
to AQ.
