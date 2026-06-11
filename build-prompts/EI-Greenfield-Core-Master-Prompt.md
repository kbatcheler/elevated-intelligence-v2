# GREENFIELD CORE MASTER PROMPT
## Different Day · Elevated Intelligence · Built New, From the Complete Specification

This replaces the original "Master Build Prompt V2" as the first build prompt. You are building Elevated Intelligence from a blank canvas, to a complete specification, with the V1 system available read-only as the behavioural and visual reference. You are NOT upgrading V1 and you must never modify it.

This build is governed by the Autonomous Execution and Drift Control Protocol: per phase, build, verify, write a drift report, remediate until truly green, commit with a `phase-<id>` tag, then advance. Never use a long em-dash anywhere, in code, copy, seed data, schema comments, or your own output. Use a comma, colon, or full stop.

## HOW TO USE THE SPECIFICATION LIBRARY

The original prompt documents in `build-prompts/` are your detailed specifications. Where this prompt says "per the spec," implement that section of the named document faithfully, adjusted only as stated here. The key references:

- `Elevated-Intelligence-V2-Master-Prompt.md` is the spec library for the cortex and Confounder (its Part 1), PIN auth (Part 2), fast seeding (Part 3), seed data (Part 4), bells and whistles (Part 5), brand (Part 6). Ignore its phase ordering, its "upgrade not rebuild" framing, and its regression contract; those belonged to the retrofit plan.
- `EI-Canonical-Layer-Content-Specification.md` is the law for layer content, metrics, gaps, and archetypes.
- `EI-V2-Platform-Experience-and-Flexibility-Master-Prompt.md` Phase AD is the design-language spec, applied here from day one rather than as a late overhaul.
- `EI-V2-Top-Down-Architecture-Review.md` is context for why the architecture is shaped this way.

## THE V1 REFERENCE

At the start of every session, ensure a read-only clone of the V1 repo exists at `reference/v1` (clone it if absent; add `reference/` to `.gitignore`). Use it three ways and no others: port the pipeline prompts and prompt-hygiene lessons (no literal example figures in generation prompts, format-only placeholders, compute from the company's own values); port `tokens.css` and the brand assets; and treat its running behaviour (the boot splash that streams pipeline progress, the narrator voice, the verified-versus-modelled claim pills, Morning Brief, Board Pack, Ask Different Day, the scenario war room, the anomaly inbox, the dependency map) as the parity reference the new system must meet or beat. Never copy V1's structural compromises: the hardcoded LAYER_KEYS constant, the single shared admin login, the legacy CompanyProfile and NarrativeBundle projection, or the static demo-data directories.

## DAY ONE NON-NEGOTIABLE (unchanged from the original, restated)

The three-model cortex and the genuine Confounder stage are the differentiating engine. They are proven on a real end-to-end seed in Phase C, immediately after foundations, before any product surface is built. The Confounder must be a genuinely running pipeline sub-stage producing real per-tenant output: never stubbed, scripted, mocked, or represented by static data. The three seats (Cortex Lens and Synthesist on Claude Sonnet, Evaluator and Enrichment on Claude Haiku, Confounder and Challenger on Gemini grounded) are wired through one cortex config and invoked on a real seed before Phase C is declared complete. If anything blocks that, stop and say so; never fake the output.

---

## PHASE A · GROUNDING

Read, in order: the protocol, this prompt, the original master prompt (as spec library), the layer content specification, the architecture review, and the V1 reference repo's `replit.md` and pipeline code. Reply with a one-screen confirmation covering: the system is a mini-Palantir-style reasoning layer that derives and discards; the greenfield rules above; the Day One Non-Negotiable; the em-dash rule; and your planned monorepo structure for Phase B. Stop and confirm per the protocol gates.

## PHASE B · FOUNDATIONS (everything that was a retrofit, built native)

Scaffold the platform with the architecture the retrofit plan had to bolt on. pnpm workspaces, Node 24, TypeScript, Express 5 API, React and Vite and Tailwind portal, Postgres with Drizzle, Zod validation, mirroring the V1 stack choices that worked.

1. **Layer registry from birth.** No LAYER_KEYS constant anywhere. A `layers` table per the Platform prompt's Phase AG spec (key, name, archetype, owner persona, diagnostic question, metric definitions, feeds, prompt fragments, isCanonical, sortOrder), seeded with the 14 canonicals from the layer content specification. The pipeline, schemas, prompts and portal consume the registry from the first line of code. Per-tenant layer config (enable, disable, rename, reorder) is part of the schema now; custom-layer creation UI comes later, the data model does not.
2. **The data model, designed once.** Tenants, tenant profile, tenant layers, artifacts, pipeline runs (modelled on V1's schema concepts), plus, native from day one: users, invite_pins, orgs and roles (provider-owner, provider-member, client-admin, client-viewer, portfolio org type, per the original Part 2 and the Operations prompt's Phase T spec, designed as one coherent model rather than two bolt-ons), and the DerivedSignalSet shape with its Zod guard from the Connectors prompt, so every future ingestion path has its contract waiting.
3. **Design system from day one.** Port `tokens.css` and the brand (navy, deep navy, cream, gold, editorial serif voice, borders not shadows). Implement the design language per the Platform prompt's Phase AD spec now, write `docs/design-language.md`, and build every subsequent screen to it. There is no late UX overhaul in this plan because there is nothing to overhaul.
4. **Tests and CI from day one.** Vitest and a GitHub Actions workflow running typecheck, build and tests on every push, from the first commit. Every later phase adds its invariant tests as it builds, including the prompt-hygiene guard (no literal example figures) and the em-dash guard.
5. **Secrets discipline.** The SecretStore interface from the Operations prompt's Phase Q, with the env-backed local implementation now and managed-secret-manager implementations later. Nothing sensitive in code or tracked config, ever.

Acceptance: clean typecheck, build and CI green on the scaffold; the 14 canonicals load from the registry; the design language document exists; the org and auth schema migrates cleanly; the DerivedSignalSet guard has a passing test.

## PHASE C · THE CORTEX AND THE CONFOUNDER (the engine, proven first)

Implement the full reasoning engine per the original master prompt Part 1: the single CORTEX config mapping the three model seats; the nine sub-stages per layer (perceive, hypothesise, confound, challenge, narrate, score, hero, peers, supplements); the Confounder as a genuine stage returning ranked confounders with mechanisms, directional impacts and ruled-out verdicts before the Challenger runs; grounding from a public homepage; verified-versus-modelled claim separation; confidence and basis as first-class fields on every metric, root cause, action and claim (per the original Part 5 item 1); and persisted per-stage pipeline-run output with token, latency and search-call telemetry per seat.

Port the V1 pipeline prompts as the starting point, preserving the prompt-hygiene rules, and adapt them to read layer definitions from the registry.

Gate: seed one real tenant end to end and show real Confounder output and live cortex telemetry from that run. This is the Day One Non-Negotiable gate; nothing proceeds past it on stubs.

## PHASE D · AUTH, ORGS AND ACCESS (designed once, built once)

Implement on the Phase B schema: PIN-gated self-registration exactly per the original Part 2 (hashed single-use expiring revocable PINs minted only by the owner, shown once; bcrypt or argon2 passwords; the stateless signed ei_session cookie carrying userId and role; owner bootstrap from OWNER_EMAIL and OWNER_PASSWORD; rate-limited register and login; the generic invalid_or_used_pin error). On top, because orgs exist natively: scoped PINs that onboard a user into a named org and role; client users fenced to their org's tenants with 403 elsewhere; the portfolio org type binding many tenants; the owner Access console (PINs, users, orgs). The break-glass access-grant model from the Connectors prompt lands later with connected data; its tables exist from Phase B.

Acceptance: the original Part 2 acceptance set, plus a client-viewer sees only their org's tenant and a portfolio user sees only their bound set.

## PHASE E · THE PRODUCT SURFACES (to the design language, against the V1 reference)

Build the portal: the boot splash streaming real pipeline progress across the nine sub-stages; layer pages rendering by archetype from the registry (the eight archetypes per the layer content specification: same chrome, morphed hero) with the analyst's take, metric tiles with confidence pills, root causes, ranked Confounder list, Challenger counter-arguments, actions with predicted recovery, gaps with the closing capability, feeds, and the collapsible "How this was reasoned" strip showing real per-tenant output from all four named stages; the Intelligence Architecture page with live telemetry per seat; Morning Brief; Board Pack; Ask Different Day; the cross-layer dependency map with the gap-propagation story; scenario war room; committed actions and track record; anomaly inbox; heartbeat. The perspective lens (Operator, Investor, Board) re-weights what layers lead with. Navigation and first-run per the Phase AD spec: any diagnosis in two clicks, first insight inside five minutes, designed loading, empty and error states everywhere, AA contrast, core surfaces usable at 375px.

Acceptance: the Phase AD acceptance set, plus a side-by-side review against V1 confirming every reference surface is met or beaten, recorded in the drift report.

## PHASE F · FAST SEEDING AND WORLD-CLASS SEED DATA

Implement the original Part 3 in full (prefix caching of the shared company profile, parallel independent stages, batched Evaluator calls, env-tunable layer concurrency, 429 backoff, resumable runs persisting per-sub-stage state, express mode with the priority layer set and honest reduced-mode marking, the idempotent seed:demo script), except build the seed limiter on the Postgres-backed queue from the Platform prompt's Phase AH from the start, not in module memory, so multi-instance correctness is native. Then seed at least four diverse demo tenants to ready per the original Part 4 and the layer content specification: distinct real companies, distinct numbers, no shared anchor figures, full depth on every layer including ranked confounders and counter-arguments, populated heroes, benchmarks, anomalies and evidence.

Acceptance: the Part 3 and Part 4 acceptance sets; measured full and express seed times recorded; four ready tenants with verifiably different figures.

## PHASE G · PARITY GATE AND CORE BUILD REPORT

The greenfield equivalent of the old regression contract. Run V1 and the new system side by side and verify every reference surface exists and works in the new system at equal or better quality; verify the full acceptance sets of Phases B through F; typecheck, build and the complete test suite green in CI; em-dash sweep zero across code, copy and data; write `docs/build-report-core.md` covering what was built, every decision defaulted, the seed timings, the parity comparison, and anything deferred with reasons.

Passing this gate means the new system replaces V1 as the reference. V1 stays deployed and frozen until you, the owner, retire it.

## WHAT FOLLOWS

After Phase G, execution continues with the downstream prompts exactly as re-sequenced in `EI-Greenfield-Build-Plan-and-Adaptation-Guide.md`: Connectors and SOC 2 (H to M, unchanged), Operations and Hardening (N to V, with the adaptations listed), Differentiation and Moat (W to AC, with the adaptations listed), and the remaining Platform phases (ingestion, local LLM, custom-layer UI, portability). That guide is binding on which phases drop, merge or change.
