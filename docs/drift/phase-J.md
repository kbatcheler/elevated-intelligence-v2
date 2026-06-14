# Phase J: The split pipeline (Tier 2, the Lens in-boundary)

Phase id: J. Name: Split Pipeline (Tier 2, the Lens in-boundary).
Milestone: no (but gated; pauses for owner confirmation before Tier 3).

Tier 2 of the connected pipeline. In connected data mode the two sensitive Lens
stages (perceive and hypothesise) run in-boundary on a local model seat, so the
client's own signals are interpreted inside the deployment boundary before anything
reaches an external provider; the external Synthesist and adversarial seats stay
external and receive only the already-derived, math-only signals and the Lens
output. The outside_in path is left byte-for-byte unchanged. A clean TEE seam is left
in place; the TEE itself is deliberately not built. This phase added zero npm
dependencies and contains no em-dash or en-dash.

## Build summary

- **The extraction-zone seam** (`lib/cortex/src/stages/extractionZone.ts`). A
  type-only contract carrying no transport: `ExtractionRequest`, `ExtractionResult`,
  `ExtractionZoneRuntime` (a single `callJson` plus a readable `model` and `endpoint`
  for telemetry, never a secret), and a per-run `StageContext` (`dataMode` plus an
  optional `extractionRuntime`) with a `DEFAULT_STAGE_CONTEXT` of outside_in. The
  cortex depends only on this interface, which is the whole point: a future TEE runner
  implements it and drops in with no stage or orchestrator change.
- **The in-boundary adapter** (`lib/cortex/src/clients/local.ts`). `callLocalJson`
  posts to an OpenAI-compatible `/v1/chat/completions` endpoint over the Node global
  `fetch`, so no dependency is added; it requests strict JSON mode, sends a Bearer
  token only when an api key is configured, honours a 429 Retry-After across
  sub-attempts, and runs one self-correcting retry that feeds the model its own
  rejected output and the schema error. There is no web-search or tool option by
  construction. `HttpExtractionRuntime` wraps it as the default
  `ExtractionZoneRuntime`; `getExtractionRuntime(env)` returns it when a local model
  is configured and null otherwise.
- **The local seat resolver** (`lib/cortex/src/config.ts`). A fourth provider,
  `local`, plus `resolveLocalSeat(env)` reading `LOCAL_MODEL_BASE_URL`,
  `LOCAL_MODEL_MODEL`, and an optional `LOCAL_MODEL_API_KEY`, returning null when
  unconfigured. The seat's model is supplied at runtime, never a literal in source, so
  the no-literal-model-string invariant holds and `SEATS` stays the three external
  seats. `CortexDataMode`, `IN_BOUNDARY_STAGES` (perceive, hypothesise), and
  `runsInBoundary(stage, dataMode)` name the split.
- **The Lens routing** (`lib/cortex/src/stages/runners.ts`). `runPerceive` and
  `runHypothesise` gained a trailing `StageContext` defaulting to outside_in. When
  `runsInBoundary` is true they call `runLocalStage` (injected runtime, or the
  configured local runtime); when none is configured they fail loud with "available,
  not connected" and never fall back to an external provider. Telemetry records the
  local model that actually ran. Every other runner and the outside_in path are
  untouched.
- **The orchestrator thread**
  (`artifacts/api-server/src/lib/pipeline/orchestrator.ts`). `runLayer` and
  `runLayers` carry a `dataMode` (default outside_in) and build the `StageContext` for
  the two Lens stages only. `seedConnectedTenant` passes "connected"; the outside_in
  seed passes nothing and is unchanged.

## Requirements checklist

- In connected mode the Lens runs in-boundary; the external seats stay external on
  de-identified signals. Done: only perceive and hypothesise branch to the local seat;
  confound, challenge, narrate, score, and enrichment keep their external models and
  see only the profile, the Lens output, and the math-only grounding.
- outside_in is byte-for-byte unchanged. Done: the runners default to an outside_in
  `StageContext`, `runsInBoundary` returns false, and the external path is taken
  unchanged; the grounding regression still proves identical prompts, and a routing
  test proves the local runtime is never consulted in outside_in mode.
- Fail loud, no silent external fallback. Done: an unconfigured connected Lens returns
  "available, not connected" with a telemetry model of "local: not connected", proven
  by test; there is no fallback branch from a connected Lens stage to an external
  provider.
- A clean TEE seam, with the TEE not built. Done: the cortex depends only on
  `ExtractionZoneRuntime`; `HttpExtractionRuntime` is the one swappable adapter today,
  and a confidential-computing runner implements the same interface later.
- Zero new deps, no long dash, no faked telemetry. Done (see the verification
  summary). The adapter is real; when unconfigured it returns null and the caller
  fails loud rather than fabricating an output.

## Drift items

Category sweep first, then specifics. Every item is acceptable drift.

- Faked, stubbed, scripted, or hardcoded output where real output was required: none.
  The in-boundary adapter is a real HTTP client proven against a real `node:http`
  server; when no local model is configured it returns null and the caller fails loud
  ("available, not connected"), never a stubbed answer. The split-routing tests use an
  injected runtime to assert routing, not to stand in for real output that was
  required this phase.
- Renamed tables, substituted libraries, or restructured layout to route around a
  problem: none. No schema change at all this phase; no library added or swapped.
- Weakened checks to pass the gate: none. The config invariant (three model literals,
  `SEATS` length three) is preserved because the local model is read from env, not
  written as a literal. No assertion was loosened.
- Scope added beyond the phase ask: none beyond the seam itself, which is the ask.
  Tier 3 (Phase K) and the portal connected-mode screens (Phase L) are deliberately
  not built here.
- Silent assumptions or defaults: none silent. The decisions are stated below.

Specific items:

- [acceptable] The in-boundary guarantee is deployment-topological, not yet
  cryptographically attested. The TEE is intentionally not built this phase; the
  deliverable is the seam (`ExtractionZoneRuntime`) plus a working HTTP adapter to a
  self-hosted model. The in-boundary property today is "the model runs on
  infrastructure the operator controls". A later confidential-computing runner adds
  hardware attestation behind the same interface with no stage or orchestrator change.
- [acceptable] The local model endpoint is a trusted deployment target. The adapter
  speaks the OpenAI-compatible wire to whatever `LOCAL_MODEL_BASE_URL` points at; the
  expected target is a loopback, private-network, or operator-controlled HTTPS
  endpoint. A misconfigured public endpoint would be an operator error. The adapter
  hardens what it can: it never logs an upstream error body (a local server could echo
  the sensitive prompt) and never exposes the api key through the seam.

## Decisions taken

- The Lens (perceive, hypothesise) is the in-boundary set; the Synthesist and
  adversarial seats stay external. The Lens is where the client's own signals are
  first interpreted, so it is the sensitivity boundary; the later seats operate on the
  already-derived output and the math-only grounding, so they can stay on the stronger
  external models without seeing raw client content.
- Fail loud, never a silent external fallback (the architect-approved Option C). A
  connected run with no local seat configured returns "available, not connected"
  rather than quietly sending the sensitive stages to an external provider. Honesty
  over availability: the operator must configure the boundary model deliberately.
- The local model identifier is read from the environment, not written as a source
  literal. This keeps the existing no-literal-model-string invariant intact and keeps
  `SEATS` at the three external seats, while letting the operator pick any self-hosted
  or open model at deploy time.
- One narrow seam (`ExtractionZoneRuntime`) for every in-boundary call. The cortex
  never knows whether the call is a plain HTTP adapter or a future attested TEE runner;
  that is what lets the TEE be added later without touching any stage.
- The adapter never logs an upstream error body. Applied as the architect's
  non-blocking privacy note: a local server could echo the sensitive prompt in an
  error, and application logs are outside the extraction boundary, so the adapter logs
  status only.

## Test and verification summary

- Typecheck: clean across the workspace (`pnpm run typecheck`).
- Build: green (`pnpm run build`).
- Tests: the full suite is green. cortex is 66, api-server 96 (plus portal, db,
  scripts, connectors, edge-agent unchanged). New this phase: `clients/local.test.ts`
  proves the in-boundary adapter posts, parses, validates, sends a Bearer only when an
  api key is set, fails loud on a non-2xx, runs the corrective retry, and survives a
  429, all against a real `node:http` server; `stages/split-pipeline.test.ts` proves
  connected mode routes the Lens to an injected runtime with the local model on
  telemetry, the unconfigured connected Lens fails loud, and outside_in never consults
  the local runtime.
- Outside_in regression: byte-for-byte unchanged, proven by the grounding regression
  test and the outside_in routing test.
- Long-dash sweep, source: the guard reports zero.
- Long-dash sweep, data: zero over all 22 public tables (a per-row text cast checked
  for U+2014 and U+2013).
- Zero new npm dependencies: workspace packages, Node built-ins, and the global fetch
  only.

## Remediation iterations

- Iteration 1 (architect evaluate_task, PASS-WITH-NITS). The architect returned a pass
  with no blocking issues and confirmed the split routing, the unchanged outside_in
  path, the fail-loud honesty with no silent fallback, and the clean TEE seam. One
  concrete non-blocking privacy note was applied immediately: the in-boundary adapter
  no longer logs the upstream error body (a local server could echo the sensitive
  prompt), logging status only; it still drains the body so the socket frees. The two
  remaining notes are recorded as accepted drift above: the local endpoint is a trusted
  deployment target, and an explicit connected-mode assertion that the non-Lens runners
  never consult the runtime is unnecessary because those runners take no
  `StageContext` and cannot reach the seam by construction.

## Verdict

Pass with noted acceptable drift. The extraction-zone seam, the in-boundary adapter,
the local seat resolver, the Lens routing, and the orchestrator dataMode thread are
built and proven. The split is correct (only the Lens runs in-boundary in connected
mode; the external seats see only de-identified signals), outside_in is byte-for-byte
unchanged, the unconfigured connected Lens fails loud with no silent fallback, and the
TEE seam is clean. The architect passed with no blocking drift; the one applied
hardening (no upstream error body in logs) and the documented acceptable drift items
(the in-boundary guarantee is topological not yet attested, the local endpoint is a
trusted target) are recorded above.

## Gate marker

Phase J is gated though not a milestone. Execution pauses here for owner confirmation
before Tier 3 (Phase K) and the portal connected-mode screens (Phase L). Do not
auto-advance.
