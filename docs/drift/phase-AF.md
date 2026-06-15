# Phase AF: the local LLM seat and sovereign mode (the whole pipeline in-boundary)

Phase id: AF. Name: local LLM seat and sovereign mode. Milestone: no (gated; the third phase of
Stage 5, Platform completion, run under the owner-authorized AE-through-AI Stage 5 sequence whose only
milestone hard stop is Phase AI). This phase nonetheless PAUSES at its own gate on a real-endpoint
blocker (see Gate), with `docs/drift/STOP.md` recording exactly what is proven here versus what needs a
running local model.

Phase AF adds a third grounding regime, `sovereign`, in which EVERY cortex stage runs in-boundary on the
local seat, the deployment reaches NO external model provider, and there is NO public-web grounding at
all. It is the regime for a client that must never let its data, or even its derived reasoning, leave the
deployment boundary. The two prior regimes are untouched: `outside_in` (the public-web regression
contract) and `connected` (the Tier 2 split, where only the two sensitive Lens stages run in-boundary)
keep their exact behaviour. Zero new npm dependencies; ASCII hyphen only in source and in data; no
fabricated telemetry, health, or output.

## The single routing predicate

`runsOnLocal(stage, dataMode)` in `lib/cortex/src/config.ts` is the one predicate every runner consults
to decide whether a stage executes on the in-boundary local seat:

- `sovereign` returns true for EVERY stage, so no external provider is ever consulted.
- `connected` delegates to the existing `runsInBoundary`, which is true only for the two
  `IN_BOUNDARY_STAGES` (`perceive`, `hypothesise`).
- `outside_in` returns false for every stage.

Because `runsOnLocal` reduces to `runsInBoundary` for the two non-sovereign modes, connected and
outside_in routing is unchanged byte-for-byte; the Phase J split tests and the outside_in grounding
regression still hold. Each runner takes one `StageContext` (`{ dataMode, extractionRuntime? }`); when
`runsOnLocal` is true it dispatches through `runLocalStage` (the `ExtractionZoneRuntime` seam from Tier
2), otherwise it takes the external path exactly as before. The same seam that backs connected mode backs
sovereign mode, so a later confidential-computing (TEE) runner implements one interface with no stage or
orchestrator change.

## The local seat and the single switch

The in-boundary seat is resolved by `resolveLocalSeat(env)` from `LOCAL_MODEL_BASE_URL` and
`LOCAL_MODEL_MODEL` (with an optional `LOCAL_MODEL_API_KEY` bearer); it returns null when no local model
is configured. The model identifier is supplied at runtime, never written as a literal in source, so the
no-literal-model invariant holds and `SEATS` stays the three external seats (`config.test.ts` still
passes). `resolveCortexDataMode(env)` is the single switch: `CORTEX_DATA_MODE=sovereign` selects sovereign,
`=connected` the Tier 2 split, anything else (including unset) outside_in. It is read once at the seed and
refresh boundaries in the orchestrator and threaded as a `StageContext`, so no stage ever reads the
environment itself. A seed resolves to `sovereign` or else `outside_in`; a refresh resolves to `sovereign`
or else `connected`; the interactive finding-challenge path resolves to `sovereign` or else `outside_in`.

## Honesty: the adversarial stages still run, ungrounded, and nothing is faked

In sovereign mode there is no Anthropic web search at `perceive` and no Gemini grounded challenge at
`confound`/`challenge`, because every stage executes on the local seat. The Confounder and Challenger
stages STILL RUN (on the local seat); their external grounding is dropped honestly rather than faked,
and no fabricated Google Search or verification channel is ever attached. `runLocalStage` stamps three
sovereign-only telemetry markers on a sovereign run and ONLY on a sovereign run, spread conditionally so
outside_in and connected telemetry is byte-for-byte unchanged:

- `executionMode: "sovereign"`,
- `groundingAvailable: false`,
- `webSearchAvailable: false`.

`groundingAvailable(dataMode)` returns false only in sovereign mode; the orchestrator and the local runner
both read it so the downgrade and the markers agree.

## Calibration: an unverifiable claim can never be shown verified

Two pure transforms in `lib/cortex/src/stages/calibration.ts` relabel an over-claimed provenance down to
the honest one at the orchestrator boundary, before anything is persisted or surfaced:

- `applySovereignNarrateCalibration` empties the Synthesist's `verified_claims` and re-files each as a
  `modelled_claim` (merging by `claim_path` so a path already modelled is not duplicated), with the honest
  rationale `SOVEREIGN_UNVERIFIED_RATIONALE` and `consistency: "unknown"`. The stored `verifiedClaims`
  array and the provenance ledger therefore never record an unverifiable claim as verified.
- `applySovereignScoreCalibration` downgrades any per-claim `basis` the Evaluator marked `verified` to
  `modelled`, so the assembled, displayed content never shows a verified badge in sovereign mode.

Both are strict NO-OPs when `groundingAvailable` is true (outside_in and connected, where the external
channels really did run), so those paths stay byte-for-byte unchanged. They never invent, delete, or
reorder a claim; they only relabel. They are wired into the orchestrator at the narrate/score boundary.

## Portal

`ReasoningStrip.tsx` derives `sovereign` from whether ANY sub-stage telemetry carries
`executionMode === "sovereign"`, and when it does renders a "Sovereign mode" pill plus an expanded note,
"Reasoned in sovereign mode" and "External grounding unavailable". `types.ts` adds the three optional
markers (`executionMode`, `groundingAvailable`, `webSearchAvailable`) to the seat telemetry type. The
telemetry flows verbatim from the runner through the persisted `sub_stages` jsonb and the existing tenant
serializer, so no migration and no new endpoint are needed; the portal shows a sovereign badge only when a
sovereign run actually recorded one, never a search or verified badge in sovereign mode.

## Tests (hermetic; no live model of any kind)

- `lib/cortex/src/stages/sovereign-pipeline.test.ts` (10). An injected recording `ExtractionZoneRuntime`
  stands in for the local seat while BOTH external clients (`callClaudeJson`, `callGeminiJson`) are
  stubbed to a loud failure via `vi.hoisted` spies, so any external call is a visible test failure rather
  than a silent fallback. The suite drives every stage (profile, perceive, hypothesise, confound,
  challenge, narrate, score, enrichment, and the two interactive finding-challenge stages), asserting each
  routes to the local runtime exactly once, carries the three sovereign markers and the real local model
  id, and that NEITHER external seat was ever consulted. A final case asserts the fail-loud contract: with
  no runtime and no `LOCAL_MODEL_*` env, a sovereign stage returns "available, not connected", still
  stamps the sovereign markers, and makes no external call (no silent external fallback).
- `lib/cortex/src/stages/calibration.test.ts` (7). The two transforms: a full downgrade of every verified
  claim to modelled with the honest rationale and unknown consistency, the merge-by-claim_path dedupe, the
  score-basis downgrade with confidence values untouched, and the strict no-ops in connected and
  outside_in mode and in sovereign mode when there is nothing to downgrade.

The connected-mode guarantee (the extraction zone makes zero frontier calls; only the two Lens stages run
in-boundary) is held by the existing Phase J split-pipeline tests, which still pass unchanged; this phase
added no new connected test (logged below).

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 819 tests (api-server 433 across 53 files, portal 225 across 18, cortex 110 across
  13, connectors 29 across 5, edge-agent 10 across 3, db 8, scripts 4), up 25 from Phase AE's 794. The new
  tests are sovereign-pipeline 10 and calibration 7 (the two new cortex files for the sovereign routing and
  the calibration), four more in cortex `homepageContext` (the shared `cleanHomepageTarget` and the
  sovereign no-fetch context), and four api-server `reduceDecision` tests; the last eight landed during the
  architect remediation recorded below (the first clean build stood at 811).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase
  AF Markdown, and a fresh database-wide cast over all 143 public text and jsonb columns across 39 base
  tables reports zero hits.
- Zero new npm dependencies (Node built-ins, the already-present `pg`, the workspace packages).

## Honest marking

What is TEST-PROVEN here, hermetically, with no live model: the sovereign routing (every stage
in-boundary, zero external calls), the three honesty markers, the verified-to-modelled calibration in both
narrate and score, and the fail-loud "available, not connected" path with no silent external fallback. The
portal sovereign surface is source-reviewed.

What is NOT done here, and would be fabricated if claimed: the real extraction quality of an actual
local or open model on the sovereign path, and a local-only full seed of a real tenant end to end in
sovereign mode (real timings and real token/cost telemetry from a real local model). These need a running
local OpenAI-compatible endpoint that this container does not provide. No telemetry, health, or output
figure is fabricated to stand in for them; the sovereign markers and model id are recorded only from a
real run (proven hermetically here, awaiting a real endpoint for live figures).

## Logged drift and deviations

- The real-endpoint blocker (see Gate and `docs/drift/STOP.md`). The container has no local
  OpenAI-compatible model server (`LOCAL_MODEL_*` unset, nothing listening, no GPU), so the sovereign path
  is proven by hermetic conformance tests and not exercised against a real local model. A local-only full
  seed and real sovereign latency/cost telemetry are deferred to an owner rerun with the endpoint
  configured.
- No new connected-mode test was added this phase; the Phase J split tests already prove the connected
  extraction zone makes zero frontier calls and remain green. The new tests target the sovereign routing
  and the calibration, the genuinely new surface area.
- The portal sovereign surface (`ReasoningStrip.tsx`, the `types.ts` markers) is source-reviewed, not
  covered by a new portal test, so the portal total stays at 225. The markers it reads ARE asserted at
  their source by the cortex `sovereign-pipeline` test.
- Stage 4 still-live item carried forward unchanged: a tenant case study is recomputed per public
  cold-link hit rather than cached (AB). Unrelated to sovereign mode; carried in the rollup, not addressed
  here.

## Gate

Phase AF passed its architect `evaluate_task` review (PASS), after the two remediation rounds recorded
below. The drift index, the rollup, and the V2 build report are updated to "A through AF". Phase AF is the
local LLM seat and sovereign-mode phase of Stage 5 (Platform completion).

Per the real-endpoint blocker (`docs/drift/STOP.md`), Phase AF PAUSES at its own gate: the container
provides no local OpenAI-compatible model endpoint (`LOCAL_MODEL_*` unset, nothing listening, no GPU), so
the sovereign path is proven hermetically (routing, honesty markers, calibration, fail-loud
available-not-connected) but is NOT exercised against a real local model. A local-only full seed and real
sovereign latency and token/cost telemetry are deferred to an owner rerun with the endpoint configured;
the build does not auto-advance to Phase AG without it. The next protocol milestone hard stop is Phase AI
at the end of Stage 5.

## Remediation iterations

The architect's `evaluate_task` review of this phase did not pass on the first or the second pass; it
returned FAIL twice, with every finding applied and the gate re-run green before the PASS recorded above.

First review (FAIL, three findings at the sovereign orchestration boundary, where the per-stage routing
meets persistence in the seed orchestrator):

- The express reduction must not apply in sovereign mode. The reduced-layer decision was extracted to a
  pure `reduceDecision.ts` (`isReducedLayer` returns false whenever the run is sovereign, so confound and
  challenge are never skipped on a sovereign layer), covered by a new four-case `reduceDecision.test.ts`.
- The express chain's generator-model label was read from config rather than from the call that ran. The
  narrate generator model is now read from the narrate sub-stage telemetry (`telemetry.model`), falling
  back to the config seat only when telemetry is absent, so a sovereign run labels the local model that
  actually ran rather than the external seat.
- The sovereign calibration had to run before persistence. `executeStage` gained a `calibrate` parameter
  threaded from the narrate and score boundaries (the no-op identity elsewhere).

Second review (FAIL, three findings: the calibration was declared but not applied, plus two residual
honesty leaks):

- `executeStage` declared the `calibrate` parameter but never applied it (it persisted and returned
  `result.output` unchanged). It now computes `const output = calibrate(result.output)` and persists and
  returns that, so the sovereign narrate/score downgrade reaches the `sub_stages` jsonb and every
  downstream consumer; in outside_in and connected mode the calibrator is the identity, so those paths
  stay byte-for-byte unchanged.
- `seedTenant` fetched the homepage over the public web even in sovereign mode, contradicting the
  no-public-web contract. A pure `sovereignNoFetchHomepageContext` (with a shared `cleanHomepageTarget`)
  now returns an honest declined context (`ok:false`, status 0, zero bytes, empty snippet, an explicit
  disabled reason) with no network IO, and `seedTenant` uses it in sovereign mode so the profile runs
  in-boundary and is honestly recorded ungrounded. Covered by four new `homepageContext` tests.
- `executeEnrichment` synthesized the folded peers and supplements telemetry with the external evaluator
  model id and no sovereign markers. It now carries `result.telemetry.model` and conditionally spreads the
  three sovereign markers from the call that actually ran, keeping `batched:true` with no token fields so
  the batched Evaluator is still counted exactly once; because hero, peers, and supplements share the
  evaluator seat, the outside_in and connected payloads are byte-for-byte unchanged.

After both rounds, typecheck and build re-ran green, the full suite re-ran green at 819, and both
long-dash sweeps (the source guard and the database-wide cast) reported zero. The architect
`evaluate_task` then returned PASS.
