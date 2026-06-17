# Post-AN drift remediation pass

Date: 2026-06-17. Scope: an owner-requested remediation pass after the Phase AN closing milestone
(Stage 6 and the whole build complete and closed), in response to the request to "resolve every
'Still live, worth attention' item" in `docs/drift/rollup.md`. This is a REMEDIATION pass, not a new
phase: it mints no Phase AO, advances no gate, and adds no new product surface. It hardens the existing
surfaces in dependency order (contract and code first, the tests that pin them next, the one cosmetic
proof, then these records and the gates), records the fresh gate and two-sided long-dash evidence, and
leaves the genuinely deferred items deferred with their reasons restated.

## Method

- Engaged the architect for the long-horizon plan (`responsibility: plan`) before any code, and again at
  the remediation milestone (`responsibility: evaluate_task`). The milestone evaluation flagged two
  blockers: a rate-limit store that keyed rows on the raw client identifier (an IP or email), and a
  ledger DB-role verify that would not catch a privilege inherited through a group or `PUBLIC`. Both were
  fixed before this record was finalised (the key is now a one-way HMAC; the verify now reads the
  effective privilege via `has_table_privilege`).
- Worked the resolution in dependency order so each tested behaviour was pinned against its final
  contract: the shared rate-limit store and the ledger DB-role hardening first, then the cortex injection
  seams and the portal pure-logic extraction, then the tests that pin all of them, then the one cosmetic
  375px proof, then these drift records and the gates.
- Re-ran the regression gates through the configured workflows: `typecheck`, `build`, and the full
  `test` suite. All three exit 0.
- Re-ran the two-sided long-dash sweep on both sides of the boundary the hard constraint draws. The
  source guard (`scripts/src/emDashGuard.ts`) scans the authored trees (`lib`, `artifacts`, `docs`,
  `scripts`): 515 files, zero on both the em-dash and the en-dash. A fresh database-wide sweep cast every
  public base-table text and jsonb column to text and matched both characters: 185 columns across 44 base
  tables that carry such columns (of 46 base tables total), zero on both sides.

## What was remediated

Each item below was live in "Still live, worth attention" before this pass and is now moved to "One-time
or resolved" in `rollup.md`. Production behaviour is unchanged by default; every new path is opt-in or a
test-only seam.

1. Shared, config-gated rate-limit store (D and O). The auth fixed-window limiter and the connector token
   buckets were per process and reset on restart, so the limit and quota did not hold across more than one
   instance. A single config seam (`RATE_LIMIT_STORE`, default `memory`) now selects the backend for both;
   `postgres` routes both through shared `rate_limit_*` tables so the limit and the quota hold across a
   fleet, read once at store construction so a deployment never mixes the two at runtime. A two-instance
   test proves two simulated processes share one window and one bucket; the in-memory default stays green.
   Privacy upgrade carried with it: the stored key is a one-way HMAC-SHA256 of the client identifier
   (pepper derived from `SESSION_SECRET` with a domain-separation label), so no raw IP or email is ever
   persisted; the schema comments say so.
2. Provenance ledger append-only enforceable at the database role (K, re-confirmed in M). The hash chain
   plus serialized append remain the runtime control, and `verifyChain` still passes unchanged. New
   `infra/sql/provenance-ledger-append-only.sql` grants a restricted application role `SELECT` and
   `INSERT` only and revokes `UPDATE`, `DELETE`, and `TRUNCATE` on `provenance_ledger`, then verifies the
   posture with a `has_table_privilege` block that raises loudly if any write privilege is present
   (catching one inherited through a group or `PUBLIC`, which a direct-grant check would miss). Honest
   boundary kept: the single-role dev database cannot demonstrate the revoke, so this is a deploy-time
   artifact documented in the migration runbook, not a dev-DB-provable control.
3. Cortex injection seams plus injected-model tests (the model-call paths of AC, AJ, AL). `runFindingChallenge`,
   the Evaluator forecast path in the orchestrator, and `runDecisionPreMortem` now take an optional runtime
   override; the default is unchanged (resolve from env), so production behaviour is identical. New
   injected-fake-model tests drive the challenge re-reason, the Evaluator forecast persistence, and the
   pre-mortem end to end through a fake model, with no billed model call, closing the "proven by source
   inspection only" gap on those write paths.
4. Read-route integration tests (the route gaps of AC, AK, AM). New HTTP integration tests cover the
   unauthenticated public diagnosis route, the efficacy read routes, and the as-of and diligence-pack read
   routes against live Postgres.
5. Portal pure-logic extraction plus unit tests (the logic portions of Y, AE, AF, AG, AJ, AK, AL, AM). The
   remaining state, format, and derivation logic was extracted out of the portal surfaces into
   framework-free modules (`portfolioView`, `calibrationView`, `customLayerView`, `decisionView`,
   `ingestionView`, `replayView`, and shared `format` helpers) and unit-tested, and the `portfolioApi`,
   `ingestionApi`, and `replayApi` clients now have their own unit tests, matching the existing client-test
   pattern. What remains is ONLY the true DOM-rendering test, still deferred under the zero-new-dependency
   rule (jsdom and a testing-library would be new dependencies); that single residual is consolidated into
   one bullet in `rollup.md`.
6. The 375px usability proof (AD), now a live measurement that caught a real defect. A live 375px Playwright
   viewport pass via the testing skill found genuine horizontal page overflow on the core-read surfaces
   (document `scrollWidth` up to 444 against an `innerWidth` of 375), which contradicted the prior
   source-only assumption that the surfaces were already responsive. The fix was made at the shared-chrome
   level (the `.page-width` and `.top-nav-*` rules, the `@media (max-width: 480px)` layer, and the top nav)
   plus a `.table-scroll` wrapper applied to the operator and admin tables. A re-measurement found all six
   surfaces (Morning Brief, a layer page, Board Pack, Portfolio, Spend, Admin) at 375/375 with no horizontal
   page overflow; a wide table now scrolls inside its own card rather than shifting the page. The binary
   screenshots are not committed; the measured numbers are the proof.

## Posture summary (what holds)

The hard constraints all hold at remediation time:

- Zero new npm dependencies. Every remediation used workspace packages and Node built-ins only: the HMAC
  is `node:crypto`, the shared store is the existing `pg` pool and Drizzle schema, the injection seams are
  plain optional parameters, and the portal modules are framework-free TypeScript. The one residual that
  WOULD need a dependency (true DOM-rendering tests) is the reason that single item stays deferred.
- ASCII hyphen only, enforced on both sides: the source guard read zero over 515 files, and a fresh
  database-wide row sweep read zero over 185 text and jsonb columns.
- No fabricated telemetry or output. The 375px proof is a real measured pass that first surfaced a real
  overflow; the ledger DB-role control is documented honestly as a deploy-time artifact the single-role
  dev DB cannot demonstrate, not claimed as dev-proven; the injected-model tests use a fake model and
  spend nothing.
- Default production behaviour is unchanged: the rate-limit store defaults to in-memory, the cortex seams
  default to env resolution, and the ledger runtime control is the unchanged hash chain.

## Areas accepted or deferred (unchanged, restated)

These remain in "Still live, worth attention" by deliberate decision and were not actioned here, each with
its reason: the `SESSION_SECRET` coupling that ties PIN hashes and session signatures to one secret (D);
the live seed concurrency benched at `LAYER_CONCURRENCY=2` against the provider 429 ceiling (F); the
express-to-full total-cost trade (F); the local KMS being a software key store rather than an HSM, with the
swappable customer-managed-key adapter (K); the per-instance `LAYER_CONCURRENCY` fan-out with no fleet-wide
ceiling, bounded by the exactly-once `pipeline_jobs` queue (AH); the cross-package suite run serialized
under a test-time DB pool cap (AE); the challenge-history honest-degradation choice (AA); the case studies
recomputed per public hit, with no measured latency violation yet (AB); the absence of a real local
OpenAI-compatible model endpoint in this container (AF, recorded in `STOP.md`); the Stage 5 cloud
owner-rerun boundary (the Docker build, the full in-container seed, a live AWS or GCP run of the
available-not-connected adapters, and `terraform apply` of `infra/gcp`, AH); the authenticated sellability
share-token route integration test (AC residual), where only the unauthenticated public diagnosis route is
now integration-tested and the mint, list, and resolve routes remain source-reviewed rather than
exercised end to end; and the single consolidated residual of true DOM-rendering tests across the portal
surfaces, deferred under the zero-new-dependency rule. Each operator action lives in
`docs/deploy-readiness.md` and the per-phase reports.

## Recurring environmental facts (not fixable in code)

- Owner secrets and `SESSION_SECRET` reach the workflow processes only, not the agent shell or the test
  runtime, so an authenticated browser flow is reached by seeding a dev `users` row with a self-generated
  scrypt hash and logging in through the real form; the 375px live pass used exactly that seeding, with
  ASCII-only data deleted afterward.
- Hosted CI cannot execute inside this environment; the gate steps run locally through the workflows and
  pass, the same evidence the hosted job would produce.
- No manual git tags: Replit manages version control through automatic checkpoints, so
  `docs/drift/INDEX.md` is the progress source of truth.

## Evidence

- `typecheck` exit 0; `build` exit 0 (portal 1771 modules transformed, api-server bundled to
  `dist/index.mjs`); `test` exit 0, the full suite green at 1130 tests across 131 files (api-server 641,
  portal 327, cortex 111, connectors 29, edge-agent 10, db 8, scripts 4). This pass added 18 new test
  files contributing 93 tests, and updated one existing test file.
- Source dash guard: scanned 515 authored files, zero on both the em-dash and the en-dash. Fresh
  database-wide sweep: zero on both characters across 185 public text and jsonb columns over 44 base tables
  that carry such columns (of 46 base tables total).
- The 375px pass: a live Playwright viewport measurement that first measured real overflow (`scrollWidth`
  up to 444 vs 375), then after the fix measured all six surfaces at 375/375 with no horizontal page
  overflow.

## Verdict

Every actioned "Still live, worth attention" item is now closed and pinned by a test; the retained
residuals (chiefly the authenticated sellability share-token route integration test and the true
DOM-rendering tests) are listed above with their reasons, and the gates and the two-sided zero long-dash
sweep are green. The 375px proof is the clearest gain: it upgraded a
source-only assumption into a live measurement that caught and fixed a real overflow. This remediation
pass advances no gate and mints no phase; Phase AN remains the closing milestone of Stage 6 and the whole
build.
