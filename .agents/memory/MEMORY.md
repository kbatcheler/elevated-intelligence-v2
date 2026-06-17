# Memory index

## Build and resume
- [EI V2 greenfield build](ei-v2-build.md) - cross-session pointers for the V2 build: V1 location, resume rules, non-negotiables.
- [EI V2 foundations gotchas](ei-v2-foundations.md) - build-env lessons (zod v4 uuid, esbuild workspace bundling).
- [EI-V2 build and drift workflow](ei-v2-build-workflow.md) - how to run checks, the two-sided dash sweep, and the drift docs each phase updates.
- [Stage 6 build (phases AJ-AN)](stage6-build.md) - the per-phase greenfield loop: resume source, drift-doc set, verification path, tool gotchas.

## Drift protocol
- [V2 drift and build-report protocol](v2-drift-protocol.md) - how each V2 phase is gated, where reports live, the long-dash sweep every phase passes.
- [Drift protocol lockstep](drift-protocol-lockstep.md) - the exact docs that move together each phase and rollup.md's internal structure.

## Gates and verification
- [Running tests and checks](test-execution.md) - run typecheck/build/test via the workflows; direct shell runs get killed.
- [Verification loop on this repo](verification-loop.md) - run and read the checks without killed processes or missing owner secrets.
- [Verifying gates and the two-sided dash sweep](verifying-gates.md) - workflow logs are lossy; run gates to a file plus exit code.
- [Stage gate workflow quirks](stage-gate-workflow-quirks.md) - log-flush ordering, guard scope gaps, a known flaky push test, the DB sweep via executeSql.
- [Functional e2e auth strategy](functional-e2e-auth.md) - driving authenticated e2e tests when owner secrets are not in the agent shell.

## Long-dash sweep
- [DB long-dash sweep gate](dash-sweep-gate.md) - the per-phase DB gate and why the source guard alone is not enough.
- [DB-wide long-dash sweep](db-long-dash-sweep.md) - how to run the DB half of the gate; the executeSql DO-block quirk.
- [Bans enforced at DB write sinks](long-dash-persistence.md) - a source-only guard misses model-generated persisted data; enforce and audit across the DB.

## Cortex and seeding
- [EI V2 cortex and seed gotchas](ei-v2-cortex.md) - live three-model cortex and seeding (grounded JSON, prompt skeletons, schema tolerance, rate limits).
- [Live seeding operations](seeding-ops.md) - run the live demo-tenant seed reliably (execution model, concurrency, failure semantics).
- [Seed-data cross-tenant distinctness](seed-data-distinctness.md) - judging whether multi-tenant seed figures are genuinely distinct vs templated.

## Connectors and data boundary
- [Connectors derive-and-discard boundary](connectors-derive-and-discard.md) - the two rules keeping extraction inside the SOC 2 derive-and-discard guarantee.
- [Connector derive-and-discard and the fs guard](connector-fs-guard.md) - how the path stays out of data-at-rest scope; the fs guard is only a tripwire.

## Security and secrets
- [Crypto-shred revoke ordering and read integrity](crypto-shred-read-integrity.md) - destroy KEK before advertising it gone; trust the active key over the blob's ref.
- [Local KMS keyring placement](local-kms-keyring.md) - where local KMS stores per-tenant KEK material and why it stays off the SecretStore.
- [Replit secret isolation](replit-secret-isolation.md) - why agent-side curl/sandbox cannot read user secrets, and how to verify secret-dependent flows.
- [Owner login recovery on the shared DB](owner-login-recovery.md) - bootstrap is create-only-if-zero-owner; a polluted owners table blocks new logins; dev and the deployment share one DB.
- [Secret-in-URL redaction chokepoint](secret-in-url-redaction.md) - any route carrying a secret in its URL must be redacted at one shared chokepoint pre-observability.
- [Async deliver access fence](async-deliver-access-fence.md) - mint-then-deliver seams must re-check tenant access at BOTH the mint and the deliver boundary.

## Provenance and honesty boundaries
- [Ledger chain-verify determinism](ledger-verify-determinism.md) - tests must assert owned-tenant sub-chains, never the global provenance-chain verify result.
- [Cost/token telemetry honesty](cost-telemetry-honesty.md) - keep model_usage cost rows honest; the no-call vs billed-failure distinction.
- [Outcome loop value/calibration honesty](outcome-loop-honesty.md) - honesty boundaries for predicted-vs-realized value, and why calibration is deliberately loose.
- [Evidence-matrix proof-type honesty](evidence-matrix-proof-types.md) - in verification phases, map each acceptance criterion to evidence with an ACCURATE proof-type.
- [Measured perf on the real path](measured-perf-on-real-path.md) - measure latency/throughput on the real production path, framed honestly, not the stub.

## Portal
- [Phase E portal architecture](phase-e-portal.md) - durable decisions for the per-tenant portal surfaces; the parallel archetype-hero fan-out contract.
- [Portal testing under zero-new-dependency](portal-testing-without-dom-deps.md) - add meaningful portal tests without jsdom/testing-library.

## Schema and tooling
- [Push a new Drizzle table before integration](schema-push-before-integration.md) - a new schema table is not in dev Postgres until pushed; integration tests 500 until then.
- [Code execution sandbox quirks](code-exec-sandbox.md) - non-obvious return shapes/limits of code_execution callbacks (executeSql, architect) and bash.
