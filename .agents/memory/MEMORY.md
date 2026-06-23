# Memory index

## Build and resume
- [EI V2 greenfield build](ei-v2-build.md) - cross-session pointers for the V2 build: V1 location, resume rules, non-negotiables.
- [EI V2 foundations gotchas](ei-v2-foundations.md) - build-env lessons (zod v4 uuid, esbuild workspace bundling).
- [EI-V2 build and drift workflow](ei-v2-build-workflow.md) - how to run checks, the two-sided dash sweep, and the drift docs each phase updates.
- [Stage 6 build (phases AJ-AN)](stage6-build.md) - the per-phase greenfield loop: resume source, drift-doc set, verification path, tool gotchas.

## Drift protocol
- [V2 drift and build-report protocol](v2-drift-protocol.md) - how each V2 phase is gated, where reports live, the long-dash sweep every phase passes.
- [Drift protocol lockstep](drift-protocol-lockstep.md) - the exact docs that move together each phase and rollup.md's internal structure.
- [Interphase drift reconciliation](interphase-drift-reconciliation.md) - out-of-band task-queue merges silently desync the ledger; reconcile (not-a-new-phase) before resuming a lettered phase.

## Gates and verification
- [Running tests and checks](test-execution.md) - run typecheck/build/test via the workflows; direct shell runs get killed.
- [Verification loop on this repo](verification-loop.md) - run and read the checks without killed processes or missing owner secrets.
- [Verifying gates and the two-sided dash sweep](verifying-gates.md) - workflow logs are lossy; run gates to a file plus exit code.
- [Stage gate workflow quirks](stage-gate-workflow-quirks.md) - log-flush ordering, guard scope gaps, the DB sweep via executeSql.
- [api-server test DB contention](api-server-test-contention.md) - why the api-server suite runs files sequentially against the one shared dev Postgres; the push-500 / 5000ms-timeout flakes it cures.
- [Orphaned test-data purge](test-data-purge.md) - marker-based, FK-ordered sweep of leftover integration-test rows from the shared dev DB; runs as a vitest globalSetup.
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
- [Owner login recovery (separate dev/prod DBs)](owner-login-recovery.md) - dev and prod are SEPARATE DBs; republish syncs schema not data; fix prod invariants via self-healing startup code, then republish.
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
- [Portal British copy vs American identifiers](portal-british-copy.md) - UI copy is British; enum values, field names, and catalog keys stay American verbatim.
- [Portal small-screen table/grid overflow](portal-small-screen-tables.md) - the <=480px guard only covers `.table-base`; raw tables and 1fr table/input grids still blow out the page.
- [Headless browser tests (zero deps)](headless-browser-cdp.md) - drive the platform chromium over CDP with Node built-ins to assert real layout/overflow; the 375px portal guard recipe.
- [Portal figure slots tolerate verbose cortex values](portal-figure-values.md) - lead/hero "figure" can be a phrase not a number; bound its column (minmax(0,Nrem) not auto) and wrap.

## Schema and tooling
- [Push a new Drizzle table before integration](schema-push-before-integration.md) - a new schema table is not in dev Postgres until pushed; integration tests 500 until then.
- [Code execution sandbox quirks](code-exec-sandbox.md) - non-obvious return shapes/limits of code_execution callbacks (executeSql, architect) and bash.
- [GitHub push from Replit](github-push-replit.md) - "push rejected" is usually the missing OAuth `workflow` scope on .github/workflows/*, not divergence; plus stale .git locks and the agent git block.
