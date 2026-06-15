# Memory index

## Elevated Intelligence V2: build, checks, drift protocol

- [EI V2 greenfield build](ei-v2-build.md) - cross-session pointers: V1 reference location, resume rules, non-negotiable constraints.
- [EI V2 foundations gotchas](ei-v2-foundations.md) - zod v4 uuid via the subpath, esbuild workspace bundling.
- [EI-V2 build & drift workflow](ei-v2-build-workflow.md) - how to run checks, the two-sided dash sweep, and the per-phase drift docs to update every phase.
- [Running tests and checks](test-execution.md) - never run vitest/tsc/build directly in the shell; the process gets killed. Use workflows.
- [Verification loop](verification-loop.md) - how to run/read checks without killed processes or chasing missing owner secrets.
- [V2 drift and build-report protocol](v2-drift-protocol.md) - how each addendum phase is gated, where the reports live, the long-dash sweep.
- [Drift protocol lockstep](drift-protocol-lockstep.md) - the exact docs that move together each phase, and rollup.md's internal structure.

## The hard constraints (how they are enforced)

- [DB long-dash sweep gate](dash-sweep-gate.md) - the per-phase gate proving zero em/en dash in the database; the source guard alone is not enough.
- [Content bans enforced at DB write sinks](long-dash-persistence.md) - a source-only guard misses model-generated persisted data; enforce and audit across the whole DB.
- [Replit secret isolation](replit-secret-isolation.md) - agent-side curl/sandbox cannot read user secrets; how to verify secret-dependent flows instead.
- [Code execution sandbox quirks](code-exec-sandbox.md) - non-obvious return shapes/limits of code_execution callbacks (executeSql, architect) and bash.
- [Measured perf on the real path](measured-perf-on-real-path.md) - measure the real production code path for a gate perf number, not the stub; frame it honestly.

## Connectors, crypto, telemetry, outcomes (the SOC 2 / honesty seams)

- [Connectors derive-and-discard boundary](connectors-derive-and-discard.md) - the two rules that keep the connector extraction path inside the derive-and-discard guarantee.
- [Connector derive-and-discard and the fs guard](connector-fs-guard.md) - how extraction stays out of data-at-rest scope; the runtime fs guard is only a tripwire.
- [Cost/token telemetry honesty](cost-telemetry-honesty.md) - the billed flag; the no-call vs billed-failure distinction a first attempt got wrong.
- [Crypto-shred revoke ordering and read integrity](crypto-shred-read-integrity.md) - destroy key material before advertising it gone; trust the active key over the blob's keyRef.
- [Local KMS keyring placement](local-kms-keyring.md) - where local KMS stores per-tenant KEK material and why it stays off the app SecretStore.
- [Ledger chain-verify determinism in tests](ledger-verify-determinism.md) - never assert a global chainVerified true; a concurrent test tampers shared ledger rows.
- [Outcome loop value/calibration honesty](outcome-loop-honesty.md) - predicted-value/measured-basis honesty rules; W's calibration is loose because AJ supersedes it.

## Cortex, seeding, portal product surfaces

- [EI V2 cortex and seed gotchas](ei-v2-cortex.md) - live three-model cortex/seed lessons (grounded JSON, schema tolerance, rate limits, resumability).
- [Live seeding operations](seeding-ops.md) - how to run the live demo-tenant seed reliably (execution model, concurrency, failure semantics).
- [Seed-data cross-tenant distinctness](seed-data-distinctness.md) - judging genuine distinctness vs templating; same-scale real companies legitimately share headline figures.
- [Phase E portal architecture](phase-e-portal.md) - durable portal product-surface decisions, especially the parallel archetype-hero fan-out contract.
- [Portal testing without DOM deps](portal-testing-without-dom-deps.md) - meaningful artifacts/portal tests when jsdom and testing-library cannot be added.
