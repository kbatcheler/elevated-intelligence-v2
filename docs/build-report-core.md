# Core Build Report: Elevated Intelligence V2

The Phase G deliverable required by the Greenfield Core Master Prompt. It covers
what was built across Phases A through F, every decision defaulted under the
autonomous protocol, the measured seed timings, the parity comparison against the
frozen V1 reference, and everything deferred with reasons. It is written at the
Phase G parity gate, which is a milestone hard-stop for owner review. Passing this
gate means the new system replaces V1 as the reference; V1 stays deployed and
frozen until the owner retires it.

## What the system is

Elevated Intelligence V2 is a mini-Palantir-style reasoning layer that derives and
discards. It grounds on a company's public homepage, runs a three-model cortex
with a genuine adversarial Confounder stage across fourteen registry-defined
layers, and renders the result as a per-tenant intelligence portal. It was built
greenfield from a blank canvas to the complete specification, with V1 available
read-only at `reference/v1` as the behavioural and visual reference. V1 is never
modified, merged, or deleted.

## Architecture

A pnpm workspace on Node 24 and TypeScript, Express 5 API, React with Vite and
Tailwind portal, Postgres with Drizzle, Zod contracts. Zero npm dependencies were
added beyond the original stack choices.

- `lib/cortex`: the pure three-model intelligence engine. No database, no HTTP. The
  CORTEX config mapping the three seats, the nine sub-stage runners, the schemas,
  the ported and adapted pipeline prompts, the grounding fetch, the score
  assembler, and the deterministic dash sanitizer.
- `lib/db`: the Drizzle schema and the database client. Tenants, tenant profile,
  tenant layers, artifacts, pipeline runs, users, invite PINs, orgs and roles, the
  layer registry, the `pipeline_jobs` claim queue, the access-grant tables, and the
  DerivedSignalSet contract guard.
- `artifacts/api-server`: Express 5. The orchestrator that owns every side effect
  (grounding, profile, the registry fan-out, per-stage persistence and telemetry),
  PIN auth, the access fence, the seed scripts, and the verification scripts.
- `artifacts/portal`: React, Vite, Tailwind. The full per-tenant portal built to
  the Phase AD design language.

## What was built, by phase

- **A, Grounding.** The protocol, the prompts, and the V1 reference were read; the
  monorepo plan, the Day One Non-Negotiable, and the long-dash rule were confirmed.
- **B, Foundations.** The native architecture the retrofit plan had to bolt on: a
  layer registry from birth (no LAYER_KEYS constant), the full data model including
  users, invite PINs, orgs and roles, the design system and `docs/design-language.md`
  ported from V1 tokens, Vitest and a GitHub Actions workflow, the SecretStore
  interface, and the DerivedSignalSet guard.
- **C, the Cortex and the Confounder.** The full reasoning engine: the single CORTEX
  config mapping the three seats (Cortex Lens and Synthesist on Claude Sonnet,
  Evaluator and Enrichment on Claude Haiku, Confounder and Challenger on Gemini
  grounded), the nine sub-stages per layer, the Confounder as a genuine stage
  returning ranked confounders with mechanisms and ruled-out verdicts before the
  Challenger runs, verified-versus-modelled claim separation, confidence and basis
  as first-class fields, and persisted per-stage telemetry. Proven on a real
  end-to-end seed of one tenant (Patagonia). This is a passed milestone.
- **D, Auth, Orgs and Access.** PIN-gated self-registration, owner-minted scoped
  PINs, scrypt passwords and HMAC PIN hashing, the stateless signed `ei_session`
  cookie, owner bootstrap from secrets, rate-limited register and login, the one
  generic `invalid_or_used_pin` error, client and portfolio tenant fencing, and the
  owner Access console.
- **E, the Product Surfaces.** The full portal built to the design language from
  real persisted data only, at or above V1 parity. See the parity comparison below.
- **F, Fast Seeding and World-Class Seed Data.** The seed engine rebuilt on the
  Postgres-backed `pipeline_jobs` claim queue, with Anthropic prompt-cache reuse,
  intra-layer parallelism, a single batched Evaluator call, and an honest express
  mode. Four real companies seeded to ready with verifiably distinct figures.

## Parity comparison against the frozen V1 reference

The Core Master Prompt names nine V1 running-behaviour surfaces the new system must
meet or beat (line 19). Every one exists in V2 and meets or beats it. Parity was
assessed at the code and component level against the frozen `reference/v1` source,
plus the full automated suite and the Phase E side-by-side acceptance recorded in
`docs/drift/phase-E.md`. It was not a live two-instance dual-deploy; that method
distinction is logged as accepted drift in `docs/drift/phase-G.md`.

| V1 reference surface | V2 location | Verdict |
| --- | --- | --- |
| Boot splash streaming pipeline progress | `artifacts/portal/src/components/BootSplash.tsx` | Meets or beats: streams the real nine sub-stages from live run state. |
| The narrator voice | `artifacts/portal/src/components/layer/sections.tsx` | Meets or beats: the analyst's take renders the real narrate-stage output. |
| Verified-versus-modelled claim pills | `artifacts/portal/src/components/primitives/Pills.tsx` | Meets or beats: confidence and basis pills are first-class on every claim. |
| Morning Brief | `artifacts/portal/src/components/pages/BriefPage.tsx` | Meets or beats. |
| Board Pack | `artifacts/portal/src/components/pages/BoardPackPage.tsx` | Meets or beats. |
| Ask Different Day | `artifacts/portal/src/components/pages/AskDifferentDayPage.tsx` | Meets, with the live-ask path deferred (see deferrals). |
| Scenario war room | `artifacts/portal/src/components/pages/WarRoomPage.tsx` | Meets, with interactive simulation deferred (see deferrals). |
| Anomaly inbox | `artifacts/portal/src/components/pages/AnomaliesPage.tsx` | Meets or beats. |
| Dependency map | `artifacts/portal/src/components/pages/DependencyMapPage.tsx` | Meets or beats: renders the cross-layer gap-propagation story. |

Beyond the named set, V2 also ships layer pages rendering by archetype from the
registry with eight morphed heroes (`artifacts/portal/src/components/heroes/`), the
Intelligence Architecture page with live per-seat telemetry
(`pages/ReasoningPage.tsx` and `primitives/ReasoningStrip.tsx`), the Data Heartbeat
(`pages/HeartbeatPage.tsx`), committed actions and track record
(`pages/ActionsPage.tsx`), Connections (`pages/ConnectionsPage.tsx`), and the
Operator, Investor, and Board perspective lens.

Three V1 extras were deliberately not carried over. None is in the named
reference-surface set and none is a Phase B through F acceptance item, so omitting
them is a scope decision, not a parity miss: the company picker and library mode,
the coachmark tour, and the signal ticker. Each can be added later if wanted.

## Seed timings

Measured from the Phase F live runs at LAYER_CONCURRENCY=2, zero pipeline errors.

| Run | Mode | Minutes | Layers built | Reduced |
| --- | --- | --- | --- | --- |
| The Hillman Group | express | 41.6 | 14 | 9 |
| Lattice | full | 46.8 | 14 | 0 |
| Hinge Health | full | 50.3 | 14 | 0 |
| The Hillman Group upgrade | full | 34.4 | 9 | 0 |

Express was about 11 to 17 percent faster end to end than a full seed. The four
ready tenants are Patagonia (seeded in Phase C), The Hillman Group, Lattice, and
Hinge Health. The cross-tenant anchor-figure sweep passes: no tenant pair and no
broadcast figure shows a templating signature.

## Every decision defaulted

- **scrypt instead of bcrypt or argon2 (D).** Both authorised alternatives ship
  native addons that are fragile under the Nix toolchain. scrypt is a strong,
  memory-hard KDF in the standard library, so it holds the zero-new-dependency rule.
  The stored hash is self-describing, so the cost can be raised later.
- **Zod v4 via the `zod/v4` subpath of zod 3.25.x (B).** The chosen contract layer.
- **`GET /api/tenants` list, access-fenced (E).** A deliberate reversal of Phase D's
  no-list stance, scoped by the access fence, so the portal can offer a tenant
  picker without exposing tenants across the fence.
- **Postgres-backed `pipeline_jobs` queue brought forward from Phase AH (F).** A new,
  separate, generic table so AH and connector work can extend it later without
  reshaping seed state.
- **Anchor-sweep templating-signature definition (F).** A failure is a tenant pair
  sharing two or more specific currency figures or over 30 percent of its currency
  anchors, or a specific figure broadcast to three or more tenants. Round figures
  and percentages stay benign. This detects a real prompt-leak signature rather than
  any real-world coincidence.
- **Live seed concurrency held at LAYER_CONCURRENCY=2 (F).** The Anthropic
  integration rate-limits hard; above about four concurrent claimers a seed hits a
  429 storm, and an errored layer is terminal. Two gives zero 429s. Recorded timings
  are conservative against the default of 5.
- **Score-stage basis coercion to `modelled` (F).** An unrecognised or missing
  Evaluator basis coerces to the conservative `modelled`, never `verified`, at the
  stage input boundary, while the stored content schema stays strict.
- **Long-dash sanitization at the persist boundary (G).** A deterministic pass
  (`deepStripDashes`) normalizes the em-dash to a spaced ASCII hyphen and the
  en-dash to a plain ASCII hyphen on every jsonb sink the orchestrator writes (the
  tenant profile, the assembled `tenant_layers` row, and the `tenant_pipeline_runs`
  sub-stage outputs), because the source guard cannot see model-generated text that
  lands in the database. See `docs/drift/phase-G.md`.
- **Parity verified at code and component level (G).** Against the frozen
  `reference/v1` source plus the full automated suite and the Phase E side-by-side,
  not a live two-instance dual-deploy. Stated honestly here and logged as drift.

## Deferred, with reasons

- **Live Ask Different Day question-and-answer path.** Ask Different Day renders from
  persisted reasoning rather than answering an arbitrary free-text question live, to
  avoid fabricating an answer outside the seeded pipeline. The surface exists; the
  open-ended live-ask path is deferred.
- **Interactive war-room simulation.** The war room presents real scenario content;
  a live interactive what-if simulator is deferred for the same anti-fabrication
  reason.
- **The three V1 extras above** (company picker and library, coachmark tour, signal
  ticker), deferred as a scope decision.
- **A shared-store auth rate limiter.** The auth limiter is per process and resets on
  restart; it needs a shared store before horizontal scaling. The seed pipeline
  already uses the Postgres-backed queue, so this caveat is scoped to auth only.
  Captured in `docs/deploy-readiness.md`.
- **Custom-layer creation UI.** The data model supports per-tenant layer config from
  Phase B; the creation UI is a later Platform phase, by design.
- **Connectors, SOC 2, operations, and the moat phases (H onward).** Out of scope for
  the Core build; their tables exist from Phase B where the spec required it.

## Verification at the gate

- Typecheck: clean across the workspace.
- Build: green. Portal builds; api-server bundles to `dist/index.mjs`.
- Tests: 253 pass. scripts 4, cortex 48, db 8, portal 108, api-server 85.
- Long-dash sweep, source: the strengthened guard (now em-dash and en-dash) reports
  zero across `lib`, `artifacts`, `docs`, and `scripts`.
- Long-dash sweep, data: zero em-dash and en-dash across all fifteen tables,
  including `tenant_pipeline_runs` after the Phase G remediation of its persisted
  sub-stage outputs.
- Anchor sweep: passes (exit 0) against the four ready tenants.

## Verdict

The gate holds. Every named V1 reference surface is met or beaten, the Phase B
through F acceptance sets pass, the full suite and build are green, and the
long-dash sweep is zero across code, copy, and data. The new system is ready to
replace V1 as the reference at the owner's discretion.
