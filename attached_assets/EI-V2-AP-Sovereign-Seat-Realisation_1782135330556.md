# Phase AP: Sovereign Seat Realisation (the in-boundary local runtime)

## Objective

The connected and sovereign data modes both route their sensitive stages to the
local seat, but `resolveLocalSeat` only reads a model from the environment and the
seat fails loudly when nothing is configured. That is correct as a guard but it
means the privacy tiering is a capability, not a deployed reality. This phase
gives the local seat a real, zero SDK in-boundary runtime over an
OpenAI compatible HTTP endpoint, so a connected run can interpret the client's own
signals in boundary and a sovereign run can complete with no external provider
touched at all. For a PE or regulated buyer a single demonstrated sovereign run is
worth more than the whole feature list.

## Ownership boundary

This phase owns `lib/cortex/src/clients/local.ts`, any new in-boundary runtime
module under `lib/cortex/src/clients/`, the cortex documentation of the local seat,
and an `artifacts/edge-agent/**` shim only if a runner is genuinely required. It
does not edit the `SEATS` object or any external model string, and it does not
touch `lib/connectors`, `artifacts/portal`, or `infra`. Routing predicates
(`runsOnLocal`, `runsInBoundary`, `resolveCortexDataMode`) already exist and are
correct; do not change their behaviour.

## Invariants (restated)

Zero new npm dependencies: the in-boundary runtime is the Node global `fetch`
against a configured endpoint, never an SDK. The local model identifier is
supplied at runtime from the environment and never appears as a literal in source,
so the no repeated model string invariant holds. Never fabricate a verification:
sovereign telemetry already carries `executionMode: "sovereign"`,
`groundingAvailable: false`, `webSearchAvailable: false`, and a sovereign verified
claim is downgraded to modelled; preserve that honesty exactly. Available, not
connected when no local endpoint is configured. Full suite green and long dash
sweep zero before close.

## Ordered tasks

1. Implement the in-boundary runtime in `local.ts`. `getExtractionRuntime()`
   returns a runtime when `LOCAL_MODEL_BASE_URL` and `LOCAL_MODEL_MODEL` are set,
   otherwise null (the available, not connected state the runner already handles).
   The runtime exposes `callJson<T>({ system, user, schema, maxTokens, log,
   context })`, posts an OpenAI compatible chat completion to the configured base
   URL with the optional `LOCAL_MODEL_API_KEY` as a bearer, enforces a bounded
   timeout, parses the JSON content, validates against the provided `zod` schema,
   and returns the same `ok` or `reason` result shape the external clients return,
   with honest token and latency telemetry and `billed` set only on a real token
   billed response.
2. Honour JSON discipline by prompt, not by a provider JSON mode that the local
   endpoint may not support: instruct the model to return only JSON, then parse
   and schema validate, and on a parse or schema miss return a loud failure that
   the orchestrator records and aborts the layer on, never a silent fallback to an
   external seat.
3. Confirm, with a test, that in connected mode only the two in-boundary Lens
   stages (`perceive`, `hypothesise`) route to the local runtime and the external
   Synthesist and adversarial seats only ever see de-identified output; and that
   in sovereign mode every stage routes to the local runtime and no external
   provider client is constructed or called.
4. Add a sovereign end to end test that runs a full layer build against a
   deterministic local runtime stub (injected through the existing
   `ctx.extractionRuntime` seam, no network), asserting that the run completes,
   that no Anthropic or Gemini client is invoked, that every verified claim is
   downgraded to modelled, and that telemetry carries the sovereign markers on
   every stage.
5. Document the local seat operation in the cortex docs and in `replit.md`'s
   neighbouring style: the three environment variables, the available, not
   connected behaviour, the connected versus sovereign routing, and the honesty
   markers. Note the recommended deployment shape for a real sovereign tenant (a
   self hosted or trusted execution environment model behind the endpoint) as an
   operator responsibility, the same honesty boundary the SecretStore draws around
   durable secret storage.

## What you must not do

Do not add a dependency or an SDK. Do not place a model identifier literal in
source. Do not alter the `SEATS` object, the external clients, or the routing
predicates. Do not let a local failure silently fall back to an external provider:
connected and sovereign must fail loudly rather than leak a sensitive stage. Do
not touch connectors, portal, or infra.

## Acceptance gate

A real in-boundary runtime drives the local seat over HTTP with no SDK and no
literal model string; connected routes only the two Lens stages in boundary and
sovereign routes everything in boundary with no external call; the sovereign end
to end test passes and proves no external client is touched and every claim is
honestly downgraded. `typecheck`, `build`, and `test` green. Long dash sweep zero.
Drift records written for phase AP: `docs/drift/phase-AP.md`, the build report
appended, the INDEX and rollup advanced to AP.
