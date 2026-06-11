# Phase C: Cortex and Confounder

Verdict: Pass. One real tenant (Patagonia) was seeded end to end with a live
three-model cortex, a genuine grounded Confounder sub-stage, and per-seat
telemetry persisted and readable through the inspection routes.

## Requirements checklist

- Real three-model cortex, no stubs. Done. `lib/cortex` runs three seats against
  live providers: the Lens and Synthesist on Claude Sonnet, the Evaluator and
  Enrichment on Claude Haiku, the Confounder and Challenger on Gemini grounded.
  The seat-to-stage map and every model string live only in `config.ts`; an
  invariant test scans the package source and fails if a model string appears
  anywhere else.
- Genuine Confounder engine. Done. The confound sub-stage runs on Gemini with
  grounding enabled and returns ranked alternative explanations, each with a
  causal mechanism, a directional impact, a verdict of ruled_out, partial, or
  unresolved, grounded reasoning, and its own source URLs. On the seeded tenant
  the brand-social layer produced four confounders citing real June 2026 events,
  with seven to eight live sources each. Nothing static, scripted, or mocked.
- Nine sub-stages in order. Done. perceive, hypothesise, confound, challenge,
  narrate, score, hero, peers, supplements. confound and challenge are the two
  grounded Gemini seats; perceive is the only web_search Anthropic seat.
- Per-stage output and per-seat telemetry persisted. Done. Each sub-stage stores
  its validated output and a telemetry record (seat, model, latency, grounding
  search calls) on the pipeline run. The fourteen runs for the seeded tenant all
  finished with all nine stages recorded.
- score is the single writer of confidence and basis. Done. The Evaluator emits
  per-claim confidence and a verified or modelled basis plus the overall layer
  confidence, capped below certainty; the assembler copies those numbers onto the
  Synthesist content and no other stage writes them.
- One real tenant seeded end to end (the gate). Done. `seed:tenant` ran against
  `https://www.patagonia.com`: profile grounded, fourteen layers built, tenant
  status ready, zero errored runs.
- No model strings outside CORTEX config, no em-dash. Done. Invariant test green;
  repo-wide U+2014 sweep clean.

## Acceptance criteria

- One real tenant seeded end to end with real Confounder output and live per-seat
  telemetry visible via route. Met. `GET /api/tenants/:id/runs` returns fourteen
  runs, each with nine telemetry-bearing sub-stages; `GET /api/tenants/:id/layers/:key`
  returns the persisted content, the ranked confounders, and the verified and
  modelled claim sets.
- All checks green. Met. `pnpm run build` (typecheck across six projects, portal
  and api-server build) and `pnpm run test` (cortex 39, db 8, api-server 6,
  scripts 3, portal none) pass. Em-dash sweep clean.
- Confounder and three-model cortex are real on a live seed. Met, see above.

## Gate evidence (seeded tenant)

- Tenant: Patagonia, id `c80493c1-c06d-4cd1-8654-56fdf9b264b5`, status ready.
- Layers built: fourteen of fourteen. Pipeline runs: fourteen done, zero errors.
- Telemetry sample (brand-social run), seat / model / latency / grounding calls:
  perceive Lens claude-sonnet-4-6 search=5; hypothesise Lens claude-sonnet-4-6;
  confound Confounder gemini-2.5-pro search=8; challenge Challenger gemini-2.5-pro
  search=8; narrate Synthesist claude-sonnet-4-6; score Evaluator claude-haiku-4-5;
  hero, peers, supplements Enrichment claude-haiku-4-5. Across layers, perceive
  grounding ran five to seven searches and the two Gemini seats seven to eleven.
- Confounder sample (brand-social), all verdict partial: intensified scrutiny of
  corporate ESG commitments; seasonal amplification of the Pattie Gonia lawsuit
  colliding with Pride Month; competitor values-marketing convergence. Six
  verified and five modelled claims persisted on the same layer.

## Drift items

- Acceptable: provider rate limits. The free-tier Anthropic and Gemini endpoints
  return frequent HTTP 429 under the fan-out. The clients absorb this with an
  inner linear backoff and an outer self-correcting retry, so the seed completes
  without manual intervention; it just runs long. No code path masks a failure as
  success.
- Acceptable: schema tolerance over rejection. Grounded seats routinely cite far
  more than eight sources and emit non-numeric sparkline values and occasional
  object-wrapped scalars. Rather than fail a whole stage on cosmetic overflow,
  the schemas coerce and slice: URL and structured-array fields slice to their
  cap, string-array fields coerce objects and single values, and the decorative
  hero trend pulls the first numeric token per point and drops any point with no
  number or no usable label. Known cosmetic limits on the sparkline: a thousand-
  separated value such as 1,200 reads as 1. Semantic enums (the verified or
  modelled basis, the confounder verdict) are never coerced; a wrong enum still
  triggers the self-correcting retry.
- Acceptable, same class as Phase B: the hosted CI workflow cannot run inside this
  Replit environment. The same four steps run locally and pass. Managed VCS means
  progress is recorded in `docs/drift/INDEX.md` rather than per-phase git tags.

## Decisions taken

- Prompt discipline for grounded Gemini: no response MIME type is set on the two
  grounded seats, because grounding and forced JSON output are mutually exclusive
  on that API. JSON is enforced by prompt instruction plus a fence-stripping and
  brace-extracting parser, then Zod validation.
- Every structured stage prompt appends an explicit JSON skeleton of the expected
  shape. Without it the models drift on structure (object instead of array,
  missing required keys, wrong enum), which the self-correcting retry could not
  reliably repair. With it, structural failures effectively disappear.
- Array caps slice instead of reject (`cappedArray`, `looseStringArray`, the URL
  arrays). The cost of failing a fifteen-minute seed on a model citing nine
  sources instead of eight is not worth the strictness; the floor (`min`) and the
  item schema still hold.
- The seed is resumable: a layer that already has a `tenant_layers` row is
  skipped, and `ensureTenant` reuses the tenant by URL, so a re-run after a fix
  re-runs only the unbuilt layers without duplicating the tenant.

## Test and verification summary

- Typecheck: clean across libs, artifacts, and scripts (six projects).
- Build: portal to `dist/public`, api-server to `dist/index.mjs`.
- Tests: cortex 39 (config invariant, SSRF grounding, JSON extractor, stage
  schemas including coercion and slicing), db 8, api-server 6, scripts 3, portal
  none. All pass.
- Em-dash sweep: clean across lib, artifacts, docs, scripts.
- Live gate: one real tenant seeded end to end; confounders and telemetry read
  back through both inspection routes.

## Milestone marker

Phase C is a milestone. This is a hard stop for owner review. Pausing before
Phase D.
