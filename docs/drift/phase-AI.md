# Phase AI: verification and the build-report append (closes Stage 5)

Phase id: AI. Name: Verification and the build-report append. Milestone: yes (the closing phase of
Stage 5, Platform completion, and the milestone hard stop at the end of the owner-authorized
AE-through-AI sequence). This phase built no product feature and changed no product code; like Phase M
closed Stage 2, Phase V closed Stage 3, and Phase AC closed Stage 4, its only artifacts are this
evidence matrix, the build-report append, and the drift updates. It added zero npm dependencies and
contains no em-dash or en-dash in source or in data.

Approach: each acceptance criterion of the Stage 5 phases (AD experience audit, AE ingestion suite, AF
local LLM seat and sovereign mode, AG curated custom-layer creation, AH cloud portability) is mapped to
the EXISTING evidence built and tested across those phases, with the proof type marked honestly (proven
by the integration suite against live Postgres, proven by a deterministic unit test, proven hermetically
by an in-process conformance server and spies with no live model, an adapter that is
available-not-connected unless its env is set, or a deploy artifact that is ASCII-verified but not built
here because this container has no Docker daemon). The global gates (typecheck, build, the full test
suite, the source dash guard, the database-wide dash sweep) were re-run fresh for this phase and the
totals below are from that run.

## The Stage 5 evidence matrix

1. Typecheck, build, and the test suite all pass, in CI. MET (integration; hosted CI is a standing
   logged drift). Fresh run: typecheck green across all workspace projects, build green (portal 1756
   modules, api-server bundled to `dist/index.mjs`), full suite green at 888 tests. CI is defined in
   `.github/workflows/ci.yml` (Phase R) as separate required typecheck, build, and test steps that
   block the merge on any nonzero exit; the hosted runner cannot execute inside this environment, so
   the same steps run locally through the workflows and pass, which is the same evidence the hosted job
   would produce (recurring environmental drift since Phase B).

2. The full-application experience meets the design language (AD). MET (presentation audit; proven by
   the unchanged green suite and source review). Phase AD was run as a short audit against
   `docs/design-language.md` rather than an overhaul: the 375px usability drift was fixed with shared
   `.page-width`, `.top-nav-row`, `.table-scroll` classes plus an `@media (max-width: 480px)` layer and
   the core read pages wrapping wide tables; the WCAG AA contrast drift was fixed with a tone-INK
   mapping (`toneInkVar`/`heroToneInkVar`) that routes normal-sized under-24px tone text to ink shades
   clearing 4.5:1, kept base hue only for large figures and non-text; a global navy-soft
   `:focus-visible` ring was added. Two-click diagnosis and sub-five-minute first insight, and distinct
   honest loading, empty, and error states with no fabricated data across every async surface (the
   shared `DataState`), were confirmed by source review; the design-language doc was reconciled to the
   implementation. AD changed CSS, shared chrome classes, and token usage only: no route, schema,
   contract, or product logic, and it added or changed no test.

3. Inbound data lands through five paths on ONE derive-and-discard core, and no raw artifact is
   persisted anywhere (AE). MET (integration against live Postgres; the central absence test is
   system-wide). The five paths (the per-tenant key gated ingestion API, the timing-safe HMAC webhooks,
   the strict-MIME manual upload with positional `column_<n>` keys, the SFTP drop that deletes every
   file processed or rejected, and the MCP server under per-tenant auth) are proven by
   `routes/ingest.integration.test.ts`, `routes/webhooks.integration.test.ts`,
   `routes/upload.integration.test.ts`, `lib/ingestion/sftpDrop.integration.test.ts`, and
   `routes/mcp.integration.test.ts`. The load-bearing acceptance, that the core derives the math and
   discards the raw input with no raw store, no raw column, and no lingering raw file, is proven
   system-wide by `routes/rawAbsence.integration.test.ts`, which drives all five paths with one unique
   sentinel and sweeps every public text and jsonb column plus the SFTP scratch directory, asserting the
   sentinel appears nowhere.

4. Sovereign mode runs every cortex stage in-boundary with honest telemetry (AF). MET (proven
   hermetically, no live model; the real-endpoint full seed is the owner-rerun boundary). In sovereign
   mode the orchestrator routes every stage through the local `ExtractionZoneRuntime` seam; confound and
   challenge still RUN but on the local seat with grounding DROPPED (no faked Google Search), and the
   profile uses a pure no-fetch homepage context. Sovereign-only telemetry markers
   (`executionMode:"sovereign"`, `groundingAvailable:false`, `webSearchAvailable:false`) are recorded
   only from a real run, a verified-to-modelled calibration is applied before persistence, and a
   sovereign run that emits `verified_claims` fails loud rather than presenting a faked verification
   channel. Proven by the cortex sovereign-pipeline and calibration tests and the in-process conformance
   server with spies: connected makes zero frontier calls from the extraction zone, and sovereign makes
   zero external Anthropic or Gemini calls anywhere, every stage on the injected local runtime with
   confound and challenge not skipped. The no-literal-model invariant holds: the local model id stays a
   SEAT in `lib/cortex/src/config.ts`. What is NOT provable here (real extraction quality and a
   local-only full seed with real latency and token and cost telemetry) is recorded honestly in
   `docs/drift/STOP.md` as the owner-rerun boundary, because this container has no local
   OpenAI-compatible endpoint (`LOCAL_MODEL_*` unset, nothing listening, no GPU).

5. A curated custom layer runs nowhere until the owner approves it, and a benchmark cohort is never
   fabricated (AG). MET (integration plus deterministic). A single `runnableLayerCondition()` predicate
   (canonical OR `approvedAt` set) gates BOTH the seed fan-out and the portal catalog, so an unapproved
   custom layer is withheld identically from per-tenant output and the catalog and the two can never
   disagree; the `.strict()` template cannot smuggle `isCanonical`, `approvedAt`, or `sortOrder`, and a
   custom layer persists UNAPPROVED. Proven by `lib/layers/customLayer.test.ts` (template validation and
   dash stripping), `routes/layers.integration.test.ts` (create unapproved, owner-only idempotent
   approve, catalog admission, authorization), and the benchmarks guardrail that excludes an unmapped
   custom layer from every cohort and pools a mapped one UNDER its canonical key. The
   `ALLOWED_ARCHETYPES` and the portal hero registry keys are kept in lockstep by the source-reading
   `customLayer.archetypeSync.test.ts`, since no package can be shared without a new dependency.

6. Each "available, not connected" seam has a second cloud target, the queue is safe across more than
   one instance, and the deploy artifacts exist (AH). MET (deterministic and integration here; the
   adapters are available-not-connected and the artifacts are ASCII-verified but not built here). One
   shared zero-dependency AWS SigV4 signer (`lib/aws/sigv4.ts`, `node:crypto` only) is pinned by AWS's
   published IAM ListUsers vector plus canonicalization properties by `lib/aws/sigv4.test.ts`; the AWS
   Secrets Manager adapter (the AWS describe cases in `secretStore.test.ts`) and the S3 archive adapter
   (the S3 describes in `archiveStore.test.ts`) mirror the GCP and GCS ones with the SAME portable ref
   grammar and write-once `If-None-Match`. The `pipeline_jobs` queue claims each job exactly once across
   two simultaneous instances with terminal rows equal to input, proven by `queue.integration.test.ts`
   against live Postgres (`LAYER_CONCURRENCY` is per-instance; fleet parallelism is instances times that,
   no fleet-wide ceiling claimed). The single-process portal-plus-API serving is proven by
   `portalStatic.integration.test.ts`. The deploy artifacts (a multi-stage `Dockerfile`, a local-parity
   `docker-compose.yml`, `infra/gcp/*.tf` including the gated `roles/run.invoker` grant that makes the
   Cloud Run URL reachable, and `docs/migration-runbook.md`) are ASCII-verified but NOT built here, and
   the Docker build and compose up, a full in-container seed, a live AWS or GCP run, and `terraform
   apply` are the honest owner-rerun boundary.

7. The regression contract holds: every load-bearing invariant from Phases A through AH still has a test
   and the suite was not weakened to pass. MET (integration; no test was broken or relaxed to verify
   this phase). The carried-forward invariants all still pass: the DerivedSignalSet guard and the
   system-wide raw-artifact absence sweep, the connector and edge-agent no-db-handle no-`node:fs` import
   boundary, the PIN failure modes and owner gating, the session cookie, the append-only hash-chained
   ledger with broken-chain detection, the no-secret-value sweep over every public column plus
   `.replit`, the per-tenant crypto isolation, the long-dash source guard, and prompt hygiene. The new
   Stage 5 surfaces added their own tests rather than editing an older assertion; this phase did not
   re-break any invariant.

8. The em-dash and en-dash sweep returns zero hits in user-facing prose and in data. MET (freshly
   re-run, both sides). The source guard (`scripts/emDashGuard.test.ts`) is green over authored source,
   including the Phase AH and AI drift and build-report Markdown written this stage, and a fresh
   database-wide cast over all 144 public text and jsonb columns across the 39 base tables reports zero
   hits. The Terraform and the root Dockerfile, which the source guard's roots do not cover, were
   verified ASCII by hand.

9. The hard constraints held across all of Stage 5. MET. Zero new npm dependencies were added in any of
   AD through AI (Node built-ins, the Node global fetch, and workspace packages only; the AWS and GCP and
   GCS targets are zero-SDK HTTP adapters that are available-not-connected until configured). No
   telemetry, health, or output is fabricated anywhere: a figure is computed from persisted state or it
   is not shown, and loading, empty, and error states are honest and distinct. The no-literal-model
   invariant holds: model identifiers live only in SEATS, never inlined.

10. Append to `docs/build-report-v2.md`. MET. The consolidated Phase AI section records what Stage 5
    delivered, the fresh gate totals, the evidence-matrix pointer, and the Stage 5 close and milestone
    pause.

## Honest integration-versus-deterministic marking

Most Stage 5 acceptance criteria are proven by the integration suite running the real application against
live Postgres (the five ingestion paths and the system-wide raw-absence sweep, the custom-layer create,
approve, and catalog gating, the multi-instance queue exactly-once claim, the single-process portal
serving), or by deterministic unit tests over pure functions (the SigV4 signer against AWS's vector, the
custom-layer template validation and archetype lockstep, the benchmark cohort math). Two classes are
honestly marked as not "live" here and verified as honest seams instead: the sovereign mode is proven
HERMETICALLY by an in-process conformance server and spies with no live model, because a real local
OpenAI-compatible endpoint is absent from this container; and the AWS Secrets Manager, S3, GCP Secret
Manager, and GCS adapters remain available-not-connected unless their env is configured, so they are
verified as honest adapters rather than live deliveries. The deploy artifacts are ASCII-verified but not
built, because this container has no Docker daemon. A third class is honestly marked source-reviewed
rather than test-proven: the portal ingestion admin client (AE) and the portal `CustomLayerPanel` (AG),
whose server endpoints and client functions ARE tested. No figure in any Stage 5 surface is fabricated: a
value is computed from persisted state or it is not shown.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal 1756 modules, api-server bundled
  to `dist/index.mjs`).
- Full suite green at 888 tests (api-server 493 across 58 files, portal 234 across 18 files, cortex 110
  across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4). This
  phase added no tests and changed no product code.
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase
  AI Markdown, and a fresh database-wide cast over all 144 public text and jsonb columns across the 39
  base tables reports zero hits. The Terraform and root Dockerfile were verified ASCII by hand because
  the source guard does not cover those roots.
- Zero new npm dependencies.

## Logged drift and deviations

- Phase AI is verification and documentation only; it built no product code, matching how Phase M closed
  Stage 2, Phase V closed Stage 3, and Phase AC closed Stage 4. Where re-running a check would have been
  destructive or paid (breaking an invariant test on purpose, running a fresh paid model seed), the
  existing in-phase evidence is cited instead and the proof type is marked.
- Hosted CI cannot execute in this environment; the CI workflow's steps run locally and pass (recurring
  environmental drift since Phase B).
- The owner-rerun boundary carried out of Stage 5: the sovereign-mode real-endpoint full seed (AF, no
  local model endpoint in this container, recorded in `STOP.md`), and the Docker build and compose up, a
  full in-container demo seed, a live AWS or GCP run of the available-not-connected adapters, and
  `terraform apply` of `infra/gcp` (AH). These are honest non-hermetic proofs the owner runs on a Docker
  host with real credentials, not defects.
- The Stage 5 accepted LOWs are test-coverage gaps, not defects: the portal ingestion admin client (AE)
  and the portal `CustomLayerPanel` (AG) are source-reviewed, with their server endpoints and client
  functions tested. The architect marked these non-blocking.
- The AH first review caught one real defect, since fixed: the GCP Terraform created the Cloud Run service
  and output its URL but granted no `roles/run.invoker`, so the URL was unreachable; a gated public-invoker
  binding plus the access-model documentation were added and the gates re-run green before the AH PASS.

## Gate

Phase AI passed its architect `evaluate_task` review (PASS). The drift index, the rollup, and the V2
build report are updated to "A through AI". Phase AI closes Stage 5 (Platform completion) and is the
final milestone of the owner-authorized AE-through-AI sequence. The build now PAUSES at the Phase AI
milestone for owner review; it does not auto-advance.
