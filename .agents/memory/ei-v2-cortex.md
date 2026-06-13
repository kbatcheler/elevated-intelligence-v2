---
name: EI V2 cortex and seed gotchas
description: Non-obvious lessons from running the live three-model cortex and seeding a real tenant (grounded JSON, prompt skeletons, schema tolerance, rate limits, resumability).
---

# EI V2 cortex and seed gotchas

Hard-won lessons from getting Phase C (live three-model cortex + grounded
Confounder) to seed a real tenant end to end. None of these are obvious from the
code alone.

## Grounded Gemini: grounding and forced JSON are mutually exclusive
The two grounded seats (confound, challenge) must NOT set a response MIME type.
Enabling Google Search grounding and forcing JSON output at the same time is not
allowed on that API. Enforce JSON by prompt instruction plus a fence-stripping
and brace-extracting parser, then Zod. Telemetry search count comes from
`groundingMetadata.webSearchQueries.length`; the Anthropic web_search seat
(perceive) counts `usage.server_tool_use.web_search_requests`.

## Every structured stage prompt needs an explicit JSON skeleton
**Why:** without a literal skeleton of the expected shape appended to the prompt,
the models drift structurally (object where an array is expected, missing
required keys, wrong enum). The self-correcting retry repairs values but NOT
structural shape reliably, so a layer hard-fails. Appending a skeleton made
structural failures effectively disappear.
**How to apply:** any new structured stage gets a skeleton in its prompt builder.
Watch camelCase vs snake_case: the narrate hypotheses use camelCase
(supportingSignals, alternativeExplanation) to match the content schema while
other stages are snake_case.

## Schema tolerance: slice and coerce cosmetic overflow, never coerce semantics
**Why:** grounded seats routinely cite far more than the cap of source URLs, emit
non-numeric sparkline values ("12%", "N/A"), and wrap scalars in objects. Failing
a fifteen-minute seed on cosmetic overflow is not worth it.
**How to apply:** array caps slice to max instead of rejecting (`cappedArray`,
`looseStringArray`, the URL arrays in `lib/cortex/src/schemas/atoms.ts`); the
decorative hero trend pulls the first numeric token per point and drops the rest.
But coercion must move toward the SAFE value, and strictness must live at the
storage boundary. The score-stage claim `basis` coerces an unknown or missing
value to the conservative `modelled` (never `verified`: unknown provenance is
never promoted) at the STAGE INPUT, which removes a fragile dependency on the
retry; the STORED content schema (`basisEnum`) stays strict so persisted data is
still exactly verified|modelled. The confounder verdict is never coerced. The
principle: tolerate cosmetic and safe-default cases at the model-output boundary,
keep the storage schema strict, and never coerce a semantic enum in a direction
that could silently overstate meaning.

## Provider rate limits dominate the seed wall-clock
Free-tier Anthropic and Gemini return frequent HTTP 429 under the layer fan-out
(sometimes empty body). Both clients have an inner linear backoff plus an outer
self-correcting retry, so the seed completes unattended; it just runs long (tens
of minutes for fourteen layers). Do not mistake slow-with-429s for stuck.

## Seeding is resumable; long seeds must run as a managed workflow
**Why:** background shell processes are reaped between tool calls, so a multi-
minute seed started from a one-off bash command dies. Run it as a managed
workflow and poll its status and the DB row count.
**How to apply:** `ensureTenant` reuses the tenant by URL and a layer with an
existing `tenant_layers` row is skipped, so after a schema fix you can re-run the
same seed and it only rebuilds the unbuilt layers, no duplicate tenant. A layer
persists its `tenant_layers` row only after all nine sub-stages succeed, so a mid-
layer failure leaves nothing to skip and that layer re-runs cleanly.
