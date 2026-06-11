# MASTER BUILD PROMPT · V2 PLATFORM, EXPERIENCE AND FLEXIBILITY
## Different Day · Elevated Intelligence · UX Overhaul, Ingestion Suite, Local LLM, Configurable Layers, Cloud Portability

This is the fifth and final build prompt, after Core V2 (A to G), Connectors and SOC 2 (H to M), Operations and Hardening (N to V), and Differentiation and Moat (W to AC). It is governed by the Autonomous Execution and Drift Control Protocol: per-phase build, verify, drift report, remediate, commit with a `phase-<id>` tag, then advance. Everything from the prior prompts holds, including the regression contract, the derive-and-discard principle, and the em-dash ban: never use a long em-dash anywhere.

These phases run last because each depends on a complete system: the UX overhaul redesigns around the full feature set rather than twice, ingestion extends the connector contract, the local model seat extends the cortex config, the configurable-layer refactor needs a tested system underneath it, and portability is verified against everything.

---

## AD · UI/UX OVERHAUL (slick, intuitive, unique, not vibe-coded)

This phase supersedes the "preserve the V1 look" instruction in the core prompt. The V1 brand stays; the V1 experience does not. Keep the identity: navy, deep navy, cream, gold, the editorial serif voice for the system speaking, borders not shadows, restraint. Rebuild the experience on top of it.

- **Information hierarchy first.** Every screen answers, in order: what is the state, what changed, what should I do. The layer page leads with the analyst's take and the headline diagnosis; detail is progressive disclosure, not a wall. No screen presents more than one primary action.
- **Navigation a stranger can use.** A persistent, legible structure: Home (Morning Brief), Layers (the 14, grouped by function), Reasoning (architecture and telemetry), Actions and Outcomes, Connections, Admin. Breadcrumbs everywhere. A user who has never seen the product must find any diagnosis within two clicks, and the first-run experience must walk a new user to their first insight inside five minutes.
- **Unique, not template.** Develop a distinct visual signature so the product is recognisable at a glance: the editorial-report aesthetic taken seriously, typographic hierarchy doing the work that boxes and shadows do in template UIs, the confidence pill and the reasoning strip as signature elements, deliberate density (an executive instrument, not a toy dashboard, and not a cluttered one). Explicitly forbidden: glassmorphism, gradient-on-everything, emoji, sparkle-AI iconography, stock dashboard grids, and any element that reads as a default component library left unstyled. Consult the frontend-design guidance available in the environment and make intentional choices; document the resulting design language in `docs/design-language.md` so it is enforceable.
- **States and motion.** Every async surface gets designed loading, empty, and error states (the seed splash already sets the bar; match it everywhere). Motion is functional only: state changes and the reasoning replay, nothing decorative.
- **Accessibility and responsiveness.** WCAG AA contrast throughout, keyboard navigable, and the core read surfaces (Morning Brief, a layer page, Board Pack) fully usable at 375px.

Acceptance: a click-depth audit shows any diagnosis reachable in two clicks; first-run reaches a first insight in under five minutes; the design language document exists and the UI matches it; zero unstyled default components; AA contrast passes; the regression contract still holds with the new skin applied consistently, including the archetype heroes.

---

## AE · THE INGESTION SUITE (every way a mid-market company actually hands you data)

Live connectors are not how most mid-market data arrives. Build five additional ingestion paths. Every one of them terminates in the same place: signals derived at the boundary, raw discarded, only `DerivedSignalSet` persisted. No ingestion path may create a raw-data store. The connector contract's Zod guard and no-write rules apply to all of them.

- **Manual upload.** Spreadsheets (xlsx, csv) and documents (pdf, docx contracts) uploaded in the portal against a tenant and a target layer. Server parses in memory, derives signals (for contracts: parties, term, value, renewal and expiry dates, auto-renew flags, obligations count, never the full text), writes the signals with provenance, and discards the file. Show the user exactly what was derived and what was discarded, which is itself a trust feature. Validate file types and sizes strictly; uploads are an attack surface, treat them as such.
- **SFTP drop.** A per-tenant SFTP credential and inbound directory; a watcher processes arrivals through the same in-memory derive path and deletes the file after processing. This is the format mid-market finance teams actually use; make it boring and reliable.
- **Ingestion API.** A versioned public API (`/v1/ingest`) with per-tenant API keys (issued and revoked in the admin console, stored hashed, rate limited) accepting structured payloads per layer. Publish an OpenAPI spec for it. This is how a client's own systems push to you.
- **MCP server.** Expose Elevated Intelligence as an MCP server with tools for both directions: `submit_signals` (ingestion) and `get_diagnosis`, `get_layer`, `get_actions` (consumption), authenticated per tenant. This makes EI a first-class citizen in agentic workflows and Claude-based stacks, which is both an ingestion path and a distribution channel.
- **Webhooks.** Inbound webhook receivers with per-source signing secrets for event-driven sources.

All paths log to the provenance ledger with the ingestion method as the source kind, so a claim can say "derived from your uploaded contract set" with the same auditability as a web citation.

Acceptance: each path proven end to end with a real file or call; the raw artifact demonstrably absent after processing (test it); a malformed or oversized upload rejected safely; API keys revocable and hashed; the MCP tools callable by an external client; and the drift report affirms no ingestion path persists raw data.

---

## AF · LOCAL LLM STRATEGY (the sovereign seat and the sovereign mode)

Two distinct deliverables. Do not conflate them.

- **The local seat.** Implement the `localModelAdapter` left as a seam in the connectors prompt: a real adapter behind the same interface as the Anthropic and Gemini wrappers, speaking to a self-hosted open-weight model via an OpenAI-compatible endpoint (vLLM or Ollama hosting a current strong open-weight model; pick the best available at build time and record the choice). In connected mode, the sensitive extraction stage routes to this seat inside the boundary or the in-client agent, so raw client data never reaches a frontier provider. This was the promise; make it run.
- **Local-only mode.** A per-deployment configuration in the cortex config that routes every seat, Lens, Confounder, Challenger, Synthesist, Evaluator, to local models, zero external calls, for the client whose posture forbids any frontier API. The Confounder and Challenger still run as genuine adversarial stages on the local models; reduced ceiling is acceptable, removed stages are not.
- **Honesty in the product.** Local-only output is marked in the UI ("reasoned in sovereign mode") and the confidence calibration reflects the weaker models rather than pretending parity. Never present local-only output as equivalent to the frontier cortex. This honesty is itself the sales posture for the sovereignty buyer.
- **Verification of the boundary.** Add a test that runs a connected-mode extraction and asserts zero outbound calls to frontier endpoints from the extraction zone, and a local-only run that asserts zero external model calls anywhere.

Acceptance: the local seat performs a real extraction in connected mode with the boundary test passing; local-only mode completes a full seed end to end with zero external model calls; the UI marks sovereign output; the cortex config is the single switch for both.

---

## AG · CONFIGURABLE INTELLIGENCE LAYERS (from static canon to ontology)

Today `LAYER_KEYS` is a compile-time constant referenced across the pipeline, schemas, prompts and portal. Refactor layers into data. This is the deepest refactor in the build; it is last-but-one for a reason, and the test suite from Phase R is your safety net. Proceed in strict order:

1. **Layer registry.** A `layers` table: key, name, description, archetype, owner persona, diagnostic question, metric definitions, feed mapping, prompt fragments, `isCanonical`, `sortOrder`. Seed the 14 canonicals into it from the current constants, byte-for-byte equivalent in behaviour.
2. **Pipeline reads the registry.** The nine-stage pipeline, schemas and prompt builders consume layer definitions from the registry instead of the constant. Run a full seed and diff the output against a pre-refactor seed: the diagnosis must be materially identical. This is the gate for everything below.
3. **Per-tenant configuration.** `tenant_layer_config`: enable or disable layers per tenant (a services business switches off supply chain), rename within the tenant's vocabulary, reorder, reweight what the cross-layer narrator emphasises. Disabled layers vanish from that tenant's portal and pipeline runs, shortening seeds.
4. **Custom layers.** A guarded template flow: name, diagnostic question, archetype (from the existing eight), four metric definitions, feeds. Custom layers run through the identical nine-stage reasoning chain, Confounder included. Owner-approved before first run, so quality stays curated.
5. **Guardrails.** Canonicals cannot be deleted, only disabled, so cross-tenant benchmark cohorts stay comparable. Custom layers are excluded from benchmarking unless explicitly mapped to a canonical. The regression contract applies to the default 14 throughout.

Acceptance: post-refactor seed materially identical to pre-refactor on the canonicals; a tenant with a disabled layer shows it nowhere and seeds faster; a custom layer completes the full reasoning chain with real per-tenant output; benchmarks unaffected by custom layers; typecheck, build and the full test suite green.

---

## AH · CLOUD PORTABILITY (provably migratable to GCP or AWS)

The code has no Replit-specific coupling and uses the standard `pg` driver; make the remaining operational pieces portable and prove it.

- **Containerise.** A production Dockerfile (and compose file for local parity) building the API and portal; twelve-factor configuration, everything via env and the SecretStore, no platform assumptions in code.
- **Replace the single-instance assumption.** Move the seed concurrency limiter from module memory to a Postgres-backed queue (advisory locks or a jobs table; no new infrastructure dependency required), so the global cap holds across multiple instances. Keep single-instance Replit as the supported small deployment.
- **Storage and secrets.** Any file-shaped persistence (ledger archives, board-pack exports) goes behind a storage interface with local-disk and object-storage (GCS or S3) implementations. SecretStore already abstracts secrets from Phase Q; add the AWS Secrets Manager implementation alongside GCP.
- **The migration runbook.** Write `docs/migration-runbook.md`: target architecture on GCP (Cloud Run plus Cloud SQL plus Secret Manager plus GCS) and the AWS equivalent, the database migration path, the cutover sequence, and the rollback. Include a minimal Terraform or equivalent definition for the GCP target so the runbook is executable, not aspirational.
- **Prove it.** Build and run the container locally against a clean Postgres, execute a full demo seed inside it, and record the result in the drift report. That is the portability proof.

Acceptance: the container runs the full system including a complete seed; the concurrency cap holds across two simultaneous instances in a test; no secret or platform assumption in the image; the runbook and infrastructure definition exist and match reality.

---

## AI · VERIFICATION AND FINAL BUILD REPORT

1. Typecheck, build and the full test suite green in CI.
2. The UX acceptance set from AD passes, and the regression contract holds under the new skin.
3. Every ingestion path proven, with raw-artifact absence tested.
4. The local seat and local-only mode pass their boundary tests.
5. The canonical layers behave identically post-refactor; configuration and custom layers work; benchmarks are unaffected.
6. The portability proof is recorded.
7. Em-dash sweep zero.
8. Write the final consolidated section of `docs/build-report-v2.md`: everything this prompt changed, the design language, the ingestion surface and its security posture, the local model choices, the layer registry, the portability proof, and a complete deferred-items list across the entire A-to-AI build with reasons.

## EXECUTION ORDER

Phases AD, AE, AF, AG, AH, AI, in order, each gated by the protocol with a drift report and a tagged commit. AG is the highest-risk refactor: if its step-2 gate (post-refactor seed identical) cannot be satisfied, hard stop per the protocol rather than shipping a behavioural change to the canonicals.
