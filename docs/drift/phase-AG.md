# Phase AG: the curated custom-layer creation flow

Phase id: AG. Name: curated custom-layer creation flow. Milestone: no (gated; the fourth phase of
Stage 5, Platform completion, run under the owner-authorized AE-through-AI sequence whose only milestone
hard stop is Phase AI). Phase AF paused at its own gate on the real-endpoint blocker (no local
OpenAI-compatible model in this container); the owner authorized proceeding, so Phase AG resumes the
sequence.

Phase AG lets the provider owner extend the layer registry itself. The `layers` table has always been
the single source of truth for layer identity (there is no `LAYER_KEYS` constant anywhere; the pipeline,
schemas, prompts, and portal all read identity from this table). AG turns "custom layers are added as
more rows later" from a latent capability into a curated, owner-gated flow: the owner creates a custom
layer from a guarded template, it is persisted UNAPPROVED so it runs nowhere until the owner approves it,
and it can optionally be mapped into the cross-tenant benchmark under a canonical layer. Zero new npm
dependencies; ASCII hyphen only in source and in data; no fabricated telemetry, health, or output;
honest distinct loading, empty, and error states.

## The single runnable predicate

`runnableLayerCondition()` in `artifacts/api-server/src/lib/layers/customLayer.ts` is the one predicate
that decides whether a layer is live: a layer is runnable exactly when it is canonical OR an owner has set
its `approvedAt`. BOTH the seed gate (`orchestrator.loadRegistry`) and the portal catalog (`GET /layers`)
call this same predicate, so the set of layers that produce per-tenant output and the set the portal lists
can never disagree. An unapproved custom layer is therefore withheld identically from the fan-out and the
catalog: the catalog never advertises a layer that has produced no output, and the seed never runs a layer
the catalog would not show.

## The schema: an approval gate and a benchmark mapping

The `layers` table gains three columns (no new table; the 39 base tables are unchanged):

- `approvedAt` (nullable timestamptz) and `approvedBy` (uuid referencing `users.id`, on delete set null):
  the owner-approval gate. A custom layer (`isCanonical=false`) does not enter the seed fan-out until
  `approvedAt` is set; `approvedBy` records which owner authorized the first run. The canonical layers are
  approved by definition (`isCanonical=true`) and leave both columns null.
- `benchmarkCanonicalKey` (nullable text, self-referencing `layers.key`, on delete set null): a custom
  layer contributes NOTHING to any benchmark cohort unless it is explicitly mapped here to a canonical
  layer, in which case its signals pool UNDER that canonical key so the cohort stays comparable. Null
  means no benchmark contribution.

(`isCanonical` already existed on the table to mark the seeded canonical 14; AG adds only the three
columns above. The one added text or jsonb column is `benchmarkCanonicalKey`.)

## Creation: a guarded template with honest defaults

`customLayerTemplateSchema` (a `.strict()` Zod object) collects only the high-signal fields the pipeline
and hero genuinely need: name, diagnosticQuestion, an archetype from the renderable set, EXACTLY four
metric tiles (the four-tile spec the canonicals follow), at least one feed, plus optional honest extras
(description, persona, hero description, module group, root causes, actions, gaps, benchmark mapping).
Because the schema is strict, a malformed request can never smuggle `isCanonical`, `approvedAt`, or
`sortOrder` past the template (asserted by test). `buildCustomLayerRow` fills every field the template
does not collect with an honest, valid-but-empty default: description falls back to the diagnostic
question (the truest one-line description of what the layer asks), persona and hero strings default empty
(the portal renders neutral), the cause, action, and gap collections default empty, and `moduleGroup`
defaults to "Custom". The whole row is run through `deepStripDashes` (the shared cortex sanitizer) so no
long dash can reach the database at this new owner-supplied text sink. The row is persisted
`isCanonical=false`, `approvedAt=null`: created, but runnable nowhere.

`allocateLayerKey` and `slugifyLayerKey` derive a stable, ASCII-only, hyphenated primary key from the
display name (diacritics decomposed and dropped, runs of non-alphanumerics collapsed to a single ASCII
hyphen, ends trimmed). Because the key is the registry primary key, a collision (including with a
canonical key) is resolved by suffixing `-2`, `-3`, and so on within a bounded loop, with a timestamped
last resort that is loud and still unique rather than a silent duplicate.

## Approval and the benchmark guardrail

`POST /api/layers/:key/approve` is owner-only and idempotent: it sets `approvedAt` and `approvedBy` on a
pending custom layer (admitting it to both the seed fan-out and the catalog through the shared predicate),
returns `alreadyApproved` without rewriting an already-approved layer, and refuses a canonical layer
(`only_custom_layers_require_approval`) or an unknown key (`layer_not_found`) with distinct errors.
`POST /api/layers` enforces that any supplied `benchmarkCanonicalKey` references an EXISTING canonical
layer (`invalid_benchmark_canonical_key`) before it persists, and the benchmark recompute
(`benchmarks.ts`) honors the mapping honestly: a custom layer with no mapping is excluded from every
cohort, and a mapped custom layer's signals pool under its canonical key, so cohort membership is never
fabricated. All four custom-layer routes are owner-only (`requireOwner`), mirroring the retention and
security routers.

## Archetype lockstep without a shared package

A custom layer must pick an archetype the portal can actually render, or its hero falls through to the
generic hero. The renderable archetypes live in the portal hero `REGISTRY`
(`artifacts/portal/src/components/heroes/registry.ts`, now exported as `ARCHETYPE_KEYS`), and the create
template validates against the server's `ALLOWED_ARCHETYPES`. There is no package both sides can import
without a new dependency, so `customLayer.archetypeSync.test.ts` reads the portal registry SOURCE and
asserts the two lists are the same set with no duplicates: a new, renamed, or removed hero on either side
fails the build, so the owner can never be offered an archetype the portal cannot render, and the two can
never silently drift. Both sides currently list the same nine renderable archetypes.

## Portal

The owner-only Access console gains a "layers" tab (`AccessConsole.tsx`) rendering `CustomLayerPanel.tsx`.
The panel loads the custom layers (`GET /layers/custom`) and the runnable catalog (`GET /layers`) in
parallel, derives the valid benchmark targets as the catalog minus the custom keys (only a canonical layer
is a valid mapping target), and offers a create form (four tiles, an archetype drawn from
`ARCHETYPE_KEYS`, feeds, an optional benchmark mapping) and a per-row approve action. Loading, empty, and
error states are distinct and honest, a 401 logs out, and a write error surfaces its server code; nothing
is fabricated. The `adminApi.ts` client gains typed loaders and writes (`fetchCustomLayers`,
`fetchCatalogLayers`, `createCustomLayer`, `approveCustomLayer`) following the existing
ready/empty/error/unauthorized and `WriteOutcome` conventions.

## Tests

- `artifacts/api-server/src/lib/layers/customLayer.test.ts` (15). The guarded template (minimal valid,
  exactly four tiles, archetype enum, non-empty feeds, strict rejection of smuggled `isCanonical` and
  `sortOrder`, blank-string rejection, optional extras), the slugifier (lowercase and hyphenate,
  diacritics, collapse, trim, empty on an all-non-ASCII name), and `buildCustomLayerRow` (honest defaults,
  `isCanonical=false` and `approvedAt=null`, dash stripping).
- `artifacts/api-server/src/lib/layers/customLayer.archetypeSync.test.ts` (1). The portal-registry
  lockstep guard described above.
- `artifacts/api-server/src/routes/layers.integration.test.ts` (8). End to end over HTTP against real
  Postgres: create and approve are owner-only, the template rejects malformed input, a benchmark mapping
  must target a canonical layer, an unapproved custom layer is withheld from `GET /layers` but visible on
  `GET /layers/custom`, and approval admits it to the catalog idempotently. Rows are namespaced by a run
  id and removed afterward.
- `artifacts/api-server/src/lib/benchmarks/benchmarks.integration.test.ts` (+1 guardrail). A canonical
  layer, an unmapped custom layer, and a mapped custom layer across six tenants: the canonical layer
  publishes, the unmapped custom layer is excluded from the cohort, and the mapped custom layer pools
  under the canonical key.
- `artifacts/portal/src/lib/adminApi.test.ts` (+9). The four new client functions: ready, empty, error,
  and unauthorized for the two loaders, and the success, error, and unauthorized outcomes for create and
  approve.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 853 tests (api-server 458 across 56 files, portal 234 across 18, cortex 110 across
  13, connectors 29 across 5, edge-agent 10 across 3, db 8, scripts 4), up 34 from Phase AF's 819. The new
  tests are api-server `customLayer` 15, `customLayer.archetypeSync` 1, `layers.integration` 8, and the
  `benchmarks.integration` guardrail (+1), plus portal `adminApi` (+9).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase
  AG Markdown, and a fresh database-wide cast over all 144 public text and jsonb columns across 39 base
  tables (the one added text column is `benchmarkCanonicalKey`; no table added) reports zero hits.
- Zero new npm dependencies (the workspace packages and the already-present `drizzle-orm` and `zod`, plus
  the shared cortex `deepStripDashes`).

## Honest marking

What is TEST-PROVEN here: the guarded template and its strict rejection of smuggled fields, the honest
defaults and dash stripping in row construction, the slugifier, the create and approve lifecycle end to
end over HTTP (owner-only, unapproved-withheld, idempotent approval, benchmark-target validation), the
single shared runnable predicate withholding an unapproved layer from BOTH the catalog and the seed
fan-out, the benchmark exclude-versus-pool guardrail, and the portal client outcomes. The archetype
lockstep is enforced at build time by a source-reading guard.

What is source-reviewed rather than test-proven (the one accepted LOW): the portal `CustomLayerPanel.tsx`
and the "layers" tab wiring in `AccessConsole.tsx`. The client functions they call ARE unit-tested in
`adminApi.test.ts`, and the routes behind them ARE integration-tested; only the React rendering is
source-reviewed, mirroring the AE ingestion-panel and AF sovereign-surface portal items.

Nothing is fabricated: a custom layer that has not run shows no per-tenant output, an unmapped custom
layer claims no benchmark membership, and the catalog lists a custom layer only once it is approved.

## Logged drift and deviations

- No dedicated portal unit test for the custom-layer panel (AG). `CustomLayerPanel.tsx` and the "layers"
  tab are source-reviewed; the `adminApi` client functions behind them are unit-tested and the `/layers`
  routes are integration-tested. Accepted as logged drift, mirroring the AE ingestion-panel and AF
  sovereign-surface items; a future lightweight portal test can close it.
- Stage 4 still-live item carried forward unchanged: a tenant case study is recomputed per public
  cold-link hit rather than cached (AB). Unrelated to custom layers; carried in the rollup, not addressed
  here.

## Gate

Phase AG passed its architect `evaluate_task` review (PASS) on the first pass, with no findings to
remediate: the create and approve lifecycle, the guarded template, key allocation, the benchmark mapping,
the archetype lockstep, and the portal integration were all assessed correct and safe, and the hard
constraints (zero new dependencies, ASCII hyphen only) hold. The drift index, the rollup, and the V2
build report are updated to "A through AG". Phase AG is the curated custom-layer creation phase of Stage 5
(Platform completion); per the owner-authorized AE-through-AI sequence it does NOT pause at its own gate,
and execution continues to Phase AH. The next protocol milestone hard stop is Phase AI at the end of
Stage 5.
