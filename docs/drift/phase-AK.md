# Phase AK: the Data Efficacy Index

Phase id: AK. Name: the Data Efficacy Index. Milestone: no (a gated per-phase stop; the build advances
to Phase AL after the AK gate). Phase AK opens Stage 6 under owner authorization, the AJ milestone pause
having been cleared by the owner to run the Stage 6 sequence (AK, AL, AM, AN) linearly.

Phase AK answers a question the confidence band does not: confidence says how sure the reasoning is,
efficacy says how good the data feeding it is. It computes a per-layer, per-tenant 0-to-100 Data Efficacy
Index from five named, weighted drivers, entirely at READ time from already-persisted state, so the index
can never drift from the data it describes. No schema is added (the base-table count stays 40); the index
mirrors the Phase O `connectionHealth` pattern (derived on read from real timestamps and rows, never
stored). A null driver is "not measured" and contributes zero but is SHOWN as a dash, never silently
counted as a zero; outside-in and connected modes differ honestly because the connector-grounded drivers
are structurally capped in outside-in mode and the index says why. Zero new npm dependencies; ASCII
hyphen only in source and in data; no fabricated telemetry, health, or output.

## The five drivers and the one documented config

`artifacts/api-server/src/lib/efficacy/config.ts` is the single documented home for the weights and the
tunables, so they cannot be quietly tuned to flatter a score. The five drivers and their default weights
(summing to 1.0, renormalized defensively):

- `coverage` (0.25): the share of a layer's declared feeds (`layers.feeds`) that are actually present as
  a connected signal source. The denominator counts only feeds that map to a connector family through
  the `feedAliasMap`; an unmappable feed label (for example a generic "News") is excluded rather than
  counted as a permanent miss.
- `freshness` (0.15): how recent the newest derived signal is, decayed against a half-life threshold
  (`EFFICACY_FRESHNESS_THRESHOLD_SECONDS`, default 86400, that is 24 hours) and bounded by a maximum age
  multiple (`EFFICACY_FRESHNESS_MAX_MULTIPLE`, default 4) so a very old signal floors at zero rather than
  going negative.
- `verificationRate` (0.25): verified claims over the sum of verified and modelled claims for the layer,
  so a layer grounded in verified evidence scores above one leaning on modelled estimates.
- `adversarialSurvival` (0.15): the share of the layer's confounders that were `ruled_out` (the finding
  survived the adversarial seat) over the total confounders raised.
- `sourceDiversity` (0.20): the count of distinct signal sources against a target
  (`EFFICACY_SOURCE_DIVERSITY_TARGET`, default 5), clamped to 1.0 at or above the target.

Each weight is independently env-overridable (`EFFICACY_WEIGHT_COVERAGE`, `EFFICACY_WEIGHT_FRESHNESS`,
`EFFICACY_WEIGHT_VERIFICATION_RATE`, `EFFICACY_WEIGHT_ADVERSARIAL_SURVIVAL`,
`EFFICACY_WEIGHT_SOURCE_DIVERSITY`); the resolved set is renormalized so the weights always sum to 1.0.
The `feedAliasMap` bridges the registry's human feed labels to connector families so the coverage
denominator is honest about which feeds are even connectable.

## The math, pure and hand-pinned

`artifacts/api-server/src/lib/efficacy/efficacyMath.ts` is pure (no database, no I/O), so every figure on
the efficacy surface is a deterministic computation a hand-worked unit test can pin down:

- `computeEfficacyIndex(drivers, { dataMode, weights })` returns a 0-to-100 weighted average of the
  measured drivers. A driver whose value is null is `not_measured`: it is reported with a dash, its
  weight is accumulated into `unknownWeight` (so the surface can disclose how much of the score is
  unmeasured), and it contributes zero rather than being dropped or treated as a zero score.
- The outside-in ceiling is enforced IN THE MATH, not just described. In `outside_in` mode the
  connector-grounded drivers (`coverage` and `freshness`) are mode-capped: their contribution is forced
  to zero, so the index can never exceed `modeCeiling = round((1 - coverageWeight - freshnessWeight) *
  100)`. A stray connected signal present on an outside-in layer can never lift it past that ceiling. In
  `connected` mode no driver is capped and the ceiling is 100.
- `cheapestImprovement` names the single best next lever: the driver whose `liftPoints` (its weight times
  the remaining headroom to 1.0, in points) is largest, with a plain-English hint. It is null when there
  is no headroom left.
- `rollupEfficacy(indices)` means the per-layer scores for the tenant rollup and returns null (never a
  fabricated zero) for an empty set.

Each driver result carries its `key`, `label`, `value`, `status` (`measured` or `not_measured`),
`weight`, `contributionPoints`, and a `reason`, so the surface can show exactly how each driver moved the
index and why.

## The read-time service

`artifacts/api-server/src/lib/efficacy/efficacyService.ts` is the read-time layer that mirrors
`connectionHealth`: it derives the index from persisted state and stores nothing. A pure
`buildLayerEfficacy(input, config)` wires the database reads (the layer's declared feeds, its verified
and modelled claim counts, its confounder verdicts, the reduced-mode flag, and its derived signals'
source connector keys and `computedAt` timestamps) into the pure math, and the three loaders run the
queries:

- `loadLayerEfficacy(tenantId, layerKey)` returns one layer's index (null if the layer was not generated
  for the tenant).
- `loadTenantEfficacy(tenantId)` returns the tenant rollup: every generated layer's index plus the mean
  across them (`rollup.score` null when no layer has been generated), the resolved `dataMode`, and the
  `modeCeiling`.
- `loadEfficacyForTenants(tenantIds)` is the batch read the portfolio board uses, returning a per-tenant
  `{ score, n }` map.

## Routes

- `artifacts/api-server/src/routes/tenants.ts` adds `efficacyIndex` to the layer detail payload (the
  read-time index shown beside the confidence band, the advisory pairing the phase is built around) and
  mounts `GET /api/tenants/:id/efficacy` behind `requireTenantAccess`, returning the tenant rollup.
- `artifacts/api-server/src/routes/portfolio.ts` enriches each board row with `efficacyScore` and
  `efficacyLayers` from the batch loader, so the portfolio view ranks companies by how well-fuelled they
  are, not just by value.

## Portfolio ranking

`artifacts/api-server/src/lib/portfolio/portfolioMath.ts` gains `efficacyScore`, `efficacyLayers`, and a
derived `efficacyRank` on each tenant metric. `efficacyRanks` ranks the board by data efficacy (the
best-fuelled company leads); a company with no generated layer (a null efficacy score) sorts last
regardless, with the company name as the deterministic tiebreak, so the value-ordered board can carry a
second, efficacy ordering without reordering itself.

## Portal

- `artifacts/portal/src/types.ts` adds the efficacy types (`EfficacyDriverKey`, `EfficacyDataMode`,
  `EfficacyDriverStatus`, `EfficacyDriverResult`, `EfficacyCheapestImprovement`, `EfficacyIndex`,
  `LayerEfficacySummary`, `TenantEfficacy`), and `efficacyScore`/`efficacyLayers`/`efficacyRank` on the
  portfolio board row.
- `artifacts/portal/src/lib/efficacyApi.ts` is a framework-free data layer mirroring `calibrationApi`: a
  pure `fetchTenantEfficacy(tenantId)` that maps a 401 to `{ unauthorized: true }` so the caller can log
  out, treats a payload without a `rollup` and a `layers` array as malformed, and returns a typed
  outcome.
- `artifacts/portal/src/components/pages/LayerPage.tsx` renders `TenantEfficacyRollup` (the company-wide
  data-efficacy rollup on the business-performance layer, with the outside-in ceiling shown when capped)
  and `EfficacyNote` per layer (the per-layer index, its drivers, and the cheapest-improvement hint), and
  `BoardPackPage.tsx` and `PortfolioPage.tsx` surface the tenant rollup and the per-company efficacy
  column. Every surface has distinct loading, ready, and error states and shows a dash, never a
  fabricated zero, for a missing or not-measured figure.

## Tests

- `artifacts/api-server/src/lib/efficacy/efficacyMath.test.ts` (19). Hand-worked driver math and index
  composition: the weighted average, a null driver counted as not-measured (zero contribution, accrued
  unknown weight) rather than a zero score, the freshness decay against the half-life and the max-age
  floor, the outside-in mode cap forcing coverage and freshness to zero contribution so the score stays
  at or below the mode ceiling, the cheapest-improvement lever selection, and the rollup mean with a null
  empty set.
- `artifacts/api-server/src/lib/efficacy/efficacyService.test.ts` (7). The driver wiring of the read-time
  service pinned to the pure math without a database, via `buildLayerEfficacy`: null for a layer not
  generated for the tenant, a fully connected and fully measured layer at 100 with no improvement left,
  coverage and the score rising when a missing feed gains a connected signal, adversarial survival rising
  when confounders are ruled out, freshness decaying with the age of the newest signal, outside-in versus
  connected differing honestly on the SAME evidence, and the Confounder stage marked not-measured for a
  reduced express build.
- `artifacts/api-server/src/lib/portfolio/portfolioMath.test.ts` (+1). The efficacy ranking: the
  best-fuelled company leads and a null efficacy score sorts last, carried as a second ordering on the
  value-ranked board.
- `artifacts/portal/src/lib/efficacyApi.test.ts` (6). The client outcomes: ready with the rollup,
  unauthorized on a 401, error on a non-ok status, error on a thrown fetch, and error on a malformed
  payload (a missing rollup and a non-array layers field).

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 956 tests (api-server 549 across 62 files, portal 246 across 20 files, cortex 110
  across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4), up 33
  from Phase AJ's 923. The new tests are api-server `efficacyMath` (19) and `efficacyService` (7) plus
  one added `portfolioMath` case, and portal `efficacyApi` (6).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase
  AK Markdown, and a fresh database-wide cast over all 150 public text and jsonb columns across the 40
  base tables (no schema is added in AK) reports zero hits.
- Zero new npm dependencies (workspace packages and Node built-ins only; the index reuses the existing
  `drizzle-orm` reads).

## Honest marking

What is TEST-PROVEN here: the pure index math against hand-worked numbers (the weighted average, the
not-measured disclosure, the freshness decay, the outside-in mode cap and ceiling, the cheapest-
improvement lever, the rollup mean); the driver wiring of the read-time service through `buildLayerEfficacy`
(coverage rising on a connected feed, survival rising on a ruled-out confounder, freshness decaying with
age, outside-in versus connected differing on identical evidence, the reduced-express not-measured mark);
the portfolio efficacy ranking with a null score sorting last; and the portal `efficacyApi` client
outcomes including the malformed-payload guard.

What is SOURCE-REVIEWED rather than test-proven (the accepted LOWs): the read-time SQL loaders
(`loadLayerEfficacy`, `loadTenantEfficacy`, `loadEfficacyForTenants`) and the routes that call them have
no dedicated efficacy-route integration test, so the SQL-to-math seam is source-reviewed and
compile-verified while the pure driver wiring it feeds IS unit-tested; and the portal efficacy rendering
(`TenantEfficacyRollup` and `EfficacyNote` on `LayerPage`, the Board Pack summary, the Portfolio column)
is source-reviewed while the `efficacyApi` client behind it is unit-tested. These mirror the earlier
read-layer and portal-rendering LOWs (AE, AF, AG, AJ).

Nothing is fabricated: a not-measured driver shows a dash and accrues disclosed unknown weight rather
than a zero, an empty rollup shows a dash rather than a zero, and an outside-in layer is held below its
honest mode ceiling with the reason shown.

## Logged drift and deviations

- The read-time efficacy loaders and the efficacy routes are source-reviewed, not behind a dedicated
  integration test (AK). `loadLayerEfficacy`, `loadTenantEfficacy`, and `loadEfficacyForTenants` and the
  `GET /api/tenants/:id/efficacy` and layer-detail routes are compile-verified and source-reviewed; the
  pure `buildLayerEfficacy` driver wiring, the `efficacyMath` index composition, and the `portfolioMath`
  efficacy ranking behind them ARE unit-tested. Accepted as logged drift, mirroring the prior read-layer
  items; a future integration test seeding feeds, claims, confounders, and signals can close it.
- No dedicated portal rendering test for the efficacy surfaces (AK). `TenantEfficacyRollup` and
  `EfficacyNote` on `LayerPage`, the Board Pack tenant summary, and the Portfolio efficacy column are
  source-reviewed; the `efficacyApi` client behind them IS unit-tested. Accepted as logged drift,
  mirroring the AE, AF, AG, and AJ portal items; a future lightweight portal test can close it.

## Gate

Phase AK passed its architect `evaluate_task` review (PASS) after one remediation round that addressed
three findings: the outside-in mode ceiling is now enforced in BOTH the pure math and the read-time
service (the mode-capped drivers are forced to zero contribution so a stray connected signal can never
lift an outside-in layer past its ceiling); the portal efficacy surfaces carry distinct loading, ready,
and error states and a dash rather than a fabricated zero for a not-measured figure; and the env-override
behaviour of the five weights is covered by the tests. The review confirmed the index is computed from
real drivers, the drivers and the cheapest-improvement hint render, connecting a feed or resolving a
confounder moves the score, outside-in and connected differ honestly, and the hard constraints hold (zero
new dependencies, ASCII hyphen only in source and data, no fabricated figure). The drift index, the
rollup, and the V2 build report are updated to "A through AK". Phase AK is not a milestone; the build
advances to Phase AL (the decision ledger and pre-mortem).
