# STOP: Phase AF pause (no real local OpenAI-compatible model endpoint)

The owner-authorized AE-through-AI Stage 5 sequence PAUSES at Phase AF. The protocol's stated condition
has been met: the final tier of the AF acceptance set needs a running local OpenAI-compatible model
endpoint, and this container does not provide one. Rather than fabricate a sovereign run, the build stops
here and records exactly what is proven and what remains, so an owner can finish the gate in minutes once
an endpoint is available.

## Why the pause

Sovereign mode runs EVERY cortex stage in-boundary on a local seat that speaks the OpenAI-compatible
`POST /v1/chat/completions` wire. This environment has no such server: `LOCAL_MODEL_BASE_URL` and
`LOCAL_MODEL_MODEL` are unset, nothing is listening on a local inference port, and there is no GPU to host
an open model. The routing, honesty, calibration, and fail-loud behaviour are all provable WITHOUT a real
model (and are proven, hermetically). The remaining items, by their nature, require a real model to run, and
producing any figure for them without one would violate the never-fabricate constraint.

## Provable here, and proven (gates green)

- The sovereign routing predicate: every stage runs in-boundary on the local seat and the deployment makes
  ZERO external model calls anywhere. Proven by `sovereign-pipeline.test.ts` with an injected runtime and
  hard-failing spies on BOTH external clients, so any external call is a visible failure, never a silent
  fallback.
- The three honesty markers (`executionMode: "sovereign"`, `groundingAvailable: false`,
  `webSearchAvailable: false`) on every sovereign stage, and on no other mode.
- The verified-to-modelled calibration in both narrate and score, so an unverifiable claim can never be
  shown or persisted as verified in sovereign mode. Proven by `calibration.test.ts`.
- Fail-loud honesty: with the local seat unconfigured, a sovereign stage returns "available, not
  connected" with no silent external fallback.
- The portal sovereign surface (the "Sovereign mode" pill and the "External grounding unavailable" note),
  shown only when a sovereign run actually recorded the marker.
- Global gates: typecheck and build green, the full suite green at 811 tests, the long-dash sweep zero on
  both sides (source guard plus a database-wide cast over all 143 public text and jsonb columns across 39
  base tables), zero new npm dependencies.

## Needs a real endpoint (NOT done here; would be fabrication if claimed)

- The real extraction quality of an actual local or open model on the sovereign path.
- A local-only full seed of a real tenant end to end in sovereign mode, with real timings and real
  token/cost telemetry read from a real local model.
- Any claim that a specific local model reaches parity with the external seats.

## Owner rerun steps (to finish the AF gate and resume at AG)

1. Stand up a local OpenAI-compatible inference server reachable from the api-server process. It must
   expose `POST /v1/chat/completions` and honour strict JSON responses.
2. Set these on the api-server workflow through the platform Secrets/env seam (never commit a value):
   - `LOCAL_MODEL_BASE_URL` the base URL, for example `http://127.0.0.1:8000/v1`.
   - `LOCAL_MODEL_MODEL` the served model id.
   - `LOCAL_MODEL_API_KEY` an optional bearer, only if the server requires one.
   - `CORTEX_DATA_MODE=sovereign`.
3. Seed a throwaway tenant. Confirm every sub-stage telemetry shows `executionMode` "sovereign", the
   `model` equal to the local model id, and NO verified badge anywhere; confirm the portal shows the
   sovereign pill and "External grounding unavailable".
4. Re-run the `typecheck`, `build`, and `test` workflows; confirm green. Confirm the long-dash sweep is
   zero on both sides.
5. Resume the AE-through-AI sequence at Phase AG (curated custom-layer creation flow).

## Status

Phase AF code is complete and gated to the limit this environment allows: the buildable, provable parts
are built and proven, and the only unmet item is the live local model, which is an operator dependency.
The drift report is `docs/drift/phase-AF.md`; the INDEX, rollup, and build report are updated to "A
through AF" once the architect `evaluate_task` review returns PASS. Do NOT auto-advance to Phase AG; that
resumes only after an owner provides a local endpoint and completes the rerun steps above, or explicitly
authorizes continuing without the live sovereign verification.
