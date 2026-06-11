# MASTER BUILD PROMPT · V2
## Different Day · Elevated Intelligence · "Mini-Palantir" Upgrade

You are upgrading an existing, working system, not building from scratch. Read this entire prompt before you touch a single file. Then execute in the gated phases below. After each phase, output a short summary and WAIT for my explicit confirmation before proceeding. Do not skip phases. Do not combine phases. Do not silently substitute libraries, rename tables, or restructure the monorepo.

**Execution mode.** This build is governed by the Autonomous Execution and Drift Control Protocol, which you must read first. Under that protocol the "stop and confirm" instruction in every phase is replaced by an automated Phase Gate: build, verify, write a drift report, remediate until truly green, then auto-advance. You run all phases to completion without waiting for me, you never fake or stub output to pass a gate, and you write an honest drift report for every phase. If the protocol is not present, run the phases gated with human confirmation as originally written.

A hard rule that overrides everything: never use a long em-dash anywhere, in code comments, UI copy, seed data, or your own status messages. Use a comma, colon, or full stop instead. Inside double-quoted display strings, use the middot character as a separator. I will reject any deliverable that contains one.

## DAY ONE NON-NEGOTIABLE (read before anything else)

The three-model cortex and the real Confounder stage in Part 1 are the differentiating engine of this product. They are not a later enhancement. They are built first, in the first substantive build phase (Phase B), immediately after grounding. This is fixed and not subject to reordering by you for convenience.

The following are hard conditions, not preferences:

- The Confounder must be a genuine, separately running pipeline sub-stage that produces real per-tenant output. It must never be stubbed, scripted, hardcoded, mocked, or represented by static demo data. A Confounder that only appears as a label on the architecture diagram is a failure of this build.
- The three model seats (Cortex Lens and Synthesist on Claude Sonnet, Evaluator and Enrichment on Claude Haiku, Confounder and Challenger on Gemini grounded) must be wired through one cortex config and actually invoked on a real seed before Phase B is declared complete.
- The architecture section and the per-layer "How this was reasoned" strip must display real output from an actual run, not scripted figures, by the end of Phase B.
- You may not proceed to any later phase until you have seeded at least one tenant end to end and shown me real Confounder output, a ranked confounder list with ruled-out verdicts, plus live cortex telemetry. If anything blocks that, stop and tell me. Do not work around it by faking the output.

If a constraint ever forces a choice between shipping the auth front door and shipping the cortex, the cortex wins and ships first. The secret sauce is embedded day one.

---

## 0 · WHAT THIS SYSTEM IS (read first, do not skip)

Elevated Intelligence is a per-tenant executive intelligence layer. You give it a company name and homepage URL, and a multi-stage LLM reasoning pipeline produces a 14-layer executive diagnosis: confidence-scored findings, root causes, recovery levers, and the architectural gaps in the company's own stack that the diagnosis revealed. Output is split into verified claims (web-cited) and modelled claims (analyst inference), served from Postgres.

Acknowledge this plainly in your first reply: this is a mini-Palantir-style system. The parallel is deliberate and correct. Like Foundry plus AIP, it is an ontology-and-reasoning layer that sits ABOVE a company's software rather than replacing it: it ingests external signal, runs adversarial multi-model reasoning over it, scores its own confidence, and surfaces both an answer and the gaps that make the answer uncertain. The product is the reasoning chain made visible and defensible, not a dashboard. Build everything in V2 to deepen that "reasoning you can audit" feeling.

### The existing stack (preserve it, do not swap)

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`)
- Portal: React + Vite + Tailwind + Radix UI (`artifacts/portal`)
- DB: PostgreSQL + Drizzle ORM (`lib/db` is the schema source of truth)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval from the OpenAPI spec (`lib/api-spec`, `lib/api-zod`, `lib/api-client-react`)
- Build: esbuild (CJS bundle)

### The repo map you must respect

- `lib/db/src/schema/` owns the tables: `tenants`, `tenant_profile`, `tenant_layers`, `tenant_artifacts`, `tenant_pipeline_runs`, `claim_broken_reports`.
- `artifacts/api-server/src/routes/index.ts` is the route table and auth gate.
- `artifacts/api-server/src/lib/pipeline/` is the generation engine. `phase2.ts` is the orchestrator. `anthropic.ts` and `gemini.ts` are the model wrappers. `prompts.ts` and `phase2-prompts.ts` hold the prompts. `seedLimiter.ts` gates concurrency. `schemas.ts` holds `LAYER_KEYS` and `ARTIFACT_KINDS`.
- `artifacts/portal/src/context/CompanyContext.tsx` is where all per-tenant content is fetched and projected into the legacy `CompanyProfile` / `NarrativeBundle` view types.
- `artifacts/portal/src/data/*` holds static demo catalogues and structural metadata only (`layers.ts` exports structural metadata, `LAYERS = []`; `feeds.ts` drives the per-layer source counts).

### The 14 canonical layers (do not rename, reorder, or drop any)

`business-performance`, `finance`, `demand-intelligence`, `competitive-intelligence`, `customer-intelligence`, `brand-social`, `supply-chain`, `pricing-margin`, `sales-pipeline`, `marketing-performance`, `people-operations`, `contract-management`, `receivables`, `talent-hr`.

### What must keep working (regression contract)

Every one of these ships today and must still work, untouched in behaviour, at the end of V2: the boot splash that streams live pipeline progress, the per-layer diagnosis pages, verified-vs-modelled claim annotations with source links and "report broken link", Morning Brief, Board Pack, Intelligence Brief, "Ask Different Day" chat, the scenario war-room, committed actions, outcome track record, the cross-layer dependency map, the system heartbeat banner, and the anomaly inbox. If a V2 change would break any of these, stop and flag it instead of shipping the break.

### Two prompt-hygiene rules that are already load-bearing, keep them

1. Generation prompts must NOT contain specific example figures (no literal bps, margin %, or dollar amounts). The model anchors to them and every tenant comes out with identical numbers. Use format-only placeholders (`-NNNbps`, `-N%`, `$Xm`) plus a "compute from this company's own values" instruction.
2. The seed concurrency limiter lives in module memory, so it is only a true global cap on a single always-on instance. The live demo deploys as a single Reserved VM for exactly this reason. Keep that assumption.

---

## 1 · THE THREE-MODEL CORTEX (formalise and make it real)

Today the pipeline already runs three models: Claude Sonnet (`claude-sonnet-4-6`) for the heavy reasoning, Claude Haiku (`claude-haiku-4-5`) for the lighter structured steps, and Gemini (`gemini-2.5-pro`) with Google Search grounding for the adversarial fact-check. V2 turns this from an implementation detail into the product's spine, and adds a genuine, distinct Confounder stage.

### 1.1 Name and fix the model roles

Define a single `CORTEX` config object (in `anthropic.ts` or a new `cortex.ts`) that is the one place models are assigned to stages. No model string should appear anywhere else. The three roles:

- **Cortex Lens and Synthesist (Claude Sonnet 4.6).** Perception, hypothesis, and the final narrative composition. The deep-reasoning seat.
- **Evaluator and Enrichment (Claude Haiku 4.5).** Scoring, confidence bands, hero panels, peer benchmarks, supplements. The fast structured seat.
- **Confounder and Challenger (Gemini 2.5 Pro, grounded).** The adversarial, web-grounded seat that tries to break the diagnosis.

### 1.2 Split Confounder out as its own stage

Right now `challenge` does adversarial fact-checking. V2 makes Confounder a separate, named sub-stage that runs BEFORE Challenger, with a distinct job. Insert it into the per-layer sub-stage list in `phase2.ts` so the order becomes:

`perceive` then `hypothesise` then `confound` then `challenge` then `narrate` then `score` then `hero` then `peers` then `supplements`.

- **Confounder** asks one question of every diagnostic hypothesis: "what else could explain this?" It searches for confounding variables, alternative causes, and statistical artefacts, and returns a ranked list of confounders that the primary diagnosis must rule out before it is accepted. Each confounder carries a name, a one-line mechanism, an estimated directional impact, and a verdict (ruled out, partial, unresolved) with a reason.
- **Challenger** (the existing adversarial step) then constructs competing hypotheses and the strongest counter-argument, and stress-tests the primary diagnosis against them.
- **Synthesist** (`narrate`) reconciles all three: the perception, the surviving hypothesis, the ruled-out confounders, and the defeated counter-arguments, into the narrative the user reads.

Update `phase2-schemas.ts` with a `confounderOutputSchema`, add the prompt builders to `phase2-prompts.ts`, persist the confounder output on `tenant_layers` (extend the layer content JSON, do not add a column unless the JSON is already typed strictly), and surface it in the UI per 1.3. Update `SUB_STAGE_NAMES`, `SUB_STAGE_COUNT`, and the splash progress math so the bar still reconciles (it will now move across 9 sub-stages per layer, roughly 126 steps per run).

### 1.3 Make the reasoning chain visible (the wow moment)

On every layer page, add a collapsible "How this was reasoned" strip that shows the four named stages with their real output for THIS layer and THIS tenant, pulled from the persisted pipeline run: Cortex Lens observation set, Confounder ruled-out list, Challenger counter-arguments, Evaluator confidence and logged gaps. This is the single most convincing element for a technical buyer. It must show real per-tenant data, not static copy.

On the Intelligence Architecture page, upgrade the existing five-component flow (Cortex Lens, Confounder, Challenger, Synthesist, Evaluator) so each card now also shows which physical model powers it and live telemetry from the most recent run: tokens consumed, latency, and web-search call count. The "Watch a question flow through the stack" panel should replay an actual recent run, not a scripted one.

---

## 2 · PIN-GATED SELF SIGN-ON (the auth redesign)

Today there is a single shared admin login from `ADMIN_USERNAME` / `ADMIN_PASSWORD`, with a stateless HMAC-signed `ei_session` cookie. V2 keeps the stateless-cookie mechanism but turns the front door into per-user self-registration that is gated by an invite PIN that only the owner can mint. Random people must not be able to sign themselves in. The PIN is the second factor that stops that.

### 2.1 The model

- **Anyone can self-register** with email, a display name, and a password they choose, BUT only if they also enter a valid, unused, unexpired PIN.
- **Only the owner (you) can create PINs.** PIN minting lives behind an owner-only admin console. There is no other way to get a PIN. No self-service, no email-the-PIN flow, no public endpoint that issues them.
- A PIN is single-use by default (configurable max-uses, default 1), has an expiry (default 14 days), and can be revoked. Once consumed it cannot be reused.
- The owner account is bootstrapped from environment secrets so there is always exactly one guaranteed way in even with an empty users table.

### 2.2 Schema (add to `lib/db/src/schema/`, then `pnpm --filter @workspace/db run push`)

- `users`: `id uuid pk`, `email text unique not null`, `displayName text not null`, `passwordHash text not null`, `role text not null default 'member'` (values: `owner`, `member`), `status text not null default 'active'` (values: `active`, `disabled`), `createdAt`, `lastLoginAt`, `invitePinId uuid` (the PIN they consumed, nullable for the bootstrapped owner).
- `invite_pins`: `id uuid pk`, `code text unique not null` (store a hash of the code, not the plaintext, see 2.4), `label text` (so you remember who it was for), `maxUses integer not null default 1`, `useCount integer not null default 0`, `expiresAt timestamptz not null`, `revokedAt timestamptz`, `createdBy uuid not null` (the owner user id), `createdAt`. A PIN is valid when `revokedAt is null AND expiresAt > now() AND useCount < maxUses`.

Add Drizzle insert/select schemas and types alongside the existing tables, matching the existing file style exactly.

### 2.3 Password and session handling (security, do this properly)

- Hash passwords with bcrypt or argon2 (add the dependency, this is the one new dependency I am explicitly authorising). Never store plaintext. Never log a password or a PIN.
- Keep the existing stateless signed-cookie design from `middlewares/auth.ts`, but extend the signed payload to carry `userId` and `role` alongside `iat`. The cookie stays `ei_session`, HMAC-SHA256 signed with `SESSION_SECRET`, httpOnly, sameSite lax, secure in production, 7-day TTL. Reuse the existing constant-time comparison and expiry logic.
- Add a `requireOwner` middleware (role must be `owner`) on top of the existing `requireAuth`. PIN management routes use `requireOwner`. Everything that is currently behind `requireAuth` stays behind `requireAuth` so any signed-in member can use the product.
- Enforce login rate limiting using the existing `middlewares/rateLimit.ts` pattern. Lock the registration and login endpoints to a sane per-IP rate.

### 2.4 PIN secrecy

Generate PINs as a human-typable but unguessable code (for example 4 groups of 4 from an unambiguous alphabet, no 0/O/1/I). Show the plaintext to the owner exactly once at creation time. Store only a hash (`scrypt` or `bcrypt`) in `invite_pins.code`. Verify at registration by hashing the submitted code and comparing. This way a database leak never exposes live PINs.

### 2.5 Routes (add to the auth router)

- `POST /auth/register`: body: email, displayName, password, pin. Validates the PIN (valid, not expired, not revoked, under max-uses), checks email is not taken, hashes the password, creates the user as `member`, increments the PIN `useCount`, sets the session cookie, returns ok. On any PIN failure return a single generic `invalid_or_used_pin` error (do not leak which condition failed).
- `POST /auth/login`: email plus password, verify hash, set cookie. Keep the trim-the-inputs hardening that already exists.
- `POST /auth/logout`: unchanged, clears the cookie.
- `GET /auth/status`: returns `{ authenticated, user: { displayName, role } | null }`.
- `POST /admin/pins` (requireOwner): body: label, optional maxUses, optional expiresInDays. Mints a PIN, returns the plaintext ONCE.
- `GET /admin/pins` (requireOwner): lists PINs with label, status (active/expired/revoked/used-up), useCount/maxUses, expiry. Never returns plaintext or hash.
- `POST /admin/pins/:id/revoke` (requireOwner): sets `revokedAt`.
- `GET /admin/users` (requireOwner): lists users with role, status, lastLoginAt. `POST /admin/users/:id/disable` (requireOwner) to disable.

### 2.6 Owner bootstrap

On boot, if no `owner` user exists and `OWNER_EMAIL` plus `OWNER_PASSWORD` env secrets are set, create the owner from them (hashing the password). Read lazily with the same throw-if-missing pattern used for `SESSION_SECRET`, so a missing secret surfaces as a clear error on first use, not a boot crash. Document the new env vars (`OWNER_EMAIL`, `OWNER_PASSWORD`) in `replit.md` and set them as masked Secrets, never as shared env vars (a shared env var is written to the git-tracked `.replit`).

### 2.7 Portal auth UI

- A clean sign-in screen on the Different Day brand (navy, cream, gold, Georgia/Calibri serif for headings). Two states: "Sign in" (email, password) and "Create account" (display name, email, password, PIN), toggled by a link.
- The PIN field is the visible second gate. Label it plainly: "Invite PIN" with helper text "Accounts require an invite PIN issued by your administrator."
- After sign-in, show the signed-in user's display name in the top bar avatar instead of the hardcoded "KB".
- An owner-only "Access" admin screen (hidden from members) with two tabs: PIN management (mint, copy-once, list, revoke) and Users (list, disable). Minting shows the plaintext PIN in a copy-to-clipboard field with a clear "this is shown once" warning.

---

## 3 · FAST SEEDING ENGINE

The current seed runs roughly 126 sub-steps (9 sub-stages across 14 layers) plus ground, profile, artifacts, and commit, at layer concurrency 4, against rate-limited model APIs. It is correct but slow. V2 makes seeding feel fast and robust without sacrificing the reasoning depth. Apply these in order and measure after each.

### 3.1 Parallelise what is independent

- Run `ground` and `profile` concurrently where `profile` does not strictly depend on the full ground output, or pipeline them so `profile` starts as soon as its inputs are ready.
- Within a layer, the three enrichment steps (`hero`, `peers`, `supplements`) are independent of each other once `narrate` and `score` are done. Run them concurrently rather than sequentially.
- Raise `LAYER_CONCURRENCY` carefully. It was moved from 3 to 4 after a caching pass freed token headroom. Try 5, then 6, watching for Anthropic 429 backoffs becoming the binding constraint. Make it an env var (`LAYER_CONCURRENCY`, default 5) so it can be tuned without a redeploy.

### 3.2 Cache the stable prefixes aggressively

The model wrappers already support per-block `cache_control`. Make sure every system prompt that is identical across the 14 layers (the role framing, the schema description, the company profile block) is sent as a cached prefix block, with only the per-layer delta uncached. The company profile is the single biggest shared prefix: cache it once and reuse it across all 14 layers in the run. This is the highest-leverage speed change.

### 3.3 Batch the Evaluator seat

`score`, `hero`, `peers`, and `supplements` run on Haiku and are cheap. Where the schema allows, combine the ones that share inputs into a single structured call per layer instead of four, halving round-trips on the fast seat.

### 3.4 Robust, resumable runs

- Make the runner resumable: persist enough per-sub-stage state on `tenant_pipeline_runs` that if a single layer's stage fails, only that stage retries, and if the process restarts mid-run, the run can resume from the last committed sub-stage rather than starting over. The failure model stays as documented (ground/profile failure fails the run; a layer stage failure degrades that layer to partial; all layers failing fails the run; artifacts failure makes the run partial).
- Add a bounded retry with exponential backoff specifically for 429s on both model providers, distinct from genuine errors.

### 3.5 Express seed for demos

Add an optional `mode` on `POST /tenants` and `POST /:id/refresh`: `full` (default, all 9 sub-stages) and `express`. Express skips `confound` plus `challenge` for non-priority layers and runs the full adversarial chain only on a configurable priority set (default: `business-performance`, `finance`, `pricing-margin`, `demand-intelligence`, `competitive-intelligence`). Express must clearly mark the layers it ran in reduced mode so nothing claims false rigour. This gives a sub-two-minute demo seed while keeping the flagship layers fully reasoned.

### 3.6 Pre-warm the demo tenants

Add a seed script (`pnpm --filter @workspace/api-server run seed:demo`) that idempotently seeds the canonical demo tenants from Part 4 to `ready` on a fresh database, so a clean deploy is never an empty shell. It should detect already-seeded tenants and skip them.

---

## 4 · WORLD-CLASS SEED DATA

Robustness here is what makes the system land in a room. Thin data reads as a toy. Build the demo set to feel like real intelligence on real companies.

### 4.1 Pre-seeded demo tenants (at least four, spanning shapes)

Seed at least four diverse, realistic mid-market companies (the ICP is roughly $30M to $2B revenue), each fully reasoned to `ready`:

1. A mid-market specialty hardware and trade business (keep the existing Mercer-shape tenant as the flagship; revenue around $127M).
2. A B2B SaaS company in the $50M to $150M ARR range.
3. A consumer brand or DTC business with a retail plus e-commerce split.
4. A services or healthcare-adjacent business.

Each must be a real, fetchable homepage URL so the verified-claims track has genuine web citations. Each must come out with DIFFERENT numbers (this is exactly why example figures are banned from prompts; verify no shared anchor like a repeated "380bps" appears across tenants).

### 4.2 Depth per layer

For every layer on every demo tenant, the data must carry: 4 metric tiles with real tone, a 3-to-5 sentence Synthesist narrative, 3 named root causes with impact figures, a ranked Confounder list with verdicts, at least 2 Challenger counter-arguments with their rejection confidence, 4 recommended actions with predicted recovery, a populated data-feed list driving the source count, the surfaced architectural gaps with category, per-gap confidence-lift in percentage points, and a named Different Day solution per gap. The cross-layer narrator insights must be specific and true to the tenant, not generic ("60% of the revenue gap traces to Demand variance in two channels", not "see the demand layer").

### 4.3 Make the bench fields real

`heroes/` and `extras/` per-layer rich visuals are currently gated to the default profile. Populate them for all demo tenants so switching tenants does not collapse to a bare layout. The anomaly inbox, activity stream, peer benchmarks, and evidence arrays must be populated per tenant, not zeroed.

---

## 5 · V2 BELLS AND WHISTLES (the "pop")

These are what take it from credible to memorable. Each must be real and wired, never a static mock.

1. **Confidence throughout, not just at the header.** Confidence is a first-class field at every level of every layer, not a single band at the top. The layer header keeps its overall band plus the gap signal ("close N gaps to reach Y% confidence" on the cross-layer map, from the per-gap confidence-lift data in 4.2). On top of that, every metric tile, every root cause, every recommended action, and every claim carries its own confidence value and its basis (verified or modelled). The Evaluator seat (Haiku) scores these in the `score` stage, and the value rises as the Confounder rules out alternatives and as sources verify, so confidence is the visible output of the reasoning chain, not a cosmetic number. Render it consistently as a small confidence pill on each element, using the existing band colour scale, with a tooltip that names what drives it: sources verified, confounders ruled out, data freshness. Extend the layer content schema so `metrics`, `rootCauses`, `actions`, and `claims` each carry `confidence` and `basis`, and populate them for every demo tenant in Part 4.
2. **Analyst's take** one-liner in the Synthesist voice above section 1 of every layer, tenant-specific.
3. **"Powered by [Module]" callouts** on every operational layer, each opening a slide-out panel that names the Different Day capability behind that layer and its indicative contract value. Map roughly 8 modules across the 14 layers.
4. **Perspective lens** wired to the currently-inert LENS control: Operator, Investor, Board. Switching re-weights what each layer leads with (Operator leads with actions, Investor with impact and risk, Board with the headline and confidence). This makes the existing dropdown do real work.
5. **Live cortex telemetry** strip on the architecture page (tokens, latency, web-search calls from the last real run, per model seat).
6. **First-visit animated overlay** that traces a question through the five-stage stack once, then never again for that user (store the seen-flag against the user, not localStorage alone, so it is per-account).
7. **Export to Board Pack PDF** from the Board Pack view (server-rendered, brand-styled).
8. **A subtle live "Live" heartbeat** already exists on the narrator; extend the system heartbeat banner to show real seed-queue depth and the active reasoning run, if any.

Hold the line on restraint. This is an editorial enterprise product, not a neon dashboard. Borders not shadows, navy and gold and cream, serif for the analyst voice, no glassmorphism, no emoji, no sparkle-AI badges.

---

## 6 · DESIGN AND BRAND (non-negotiable)

- Palette: navy `#1B2A4E`, deep navy `#0F1A33`, cream `#F4F1EA`, paper `#FFFFFF`, gold `#C8A24A`, plus the existing accent set (coral, teal, amber, red, blue, purple) for tone. Use the existing `tokens.css`; do not invent new colours.
- Type: serif for narrative and the "system speaking" voice (the existing Georgia/serif family), sans for chrome, labels, and data. Two weights per element maximum.
- Cards: 1px border, 4px radius, no drop shadow, 3px top accent stripe in the relevant colour. 24px padding standard.
- The em-dash ban applies to all of `artifacts/portal/src/data/**/*.ts`, all narrator and hero copy, every prose component, every piece of seed data, and your own status output. Run a final sweep and report the count (it must be zero in user-facing prose and data).
- Mobile: audit at 375px. The portal is desktop-first; at minimum the auth screens, Morning Brief, and a single layer page must be legible and usable on a phone.

### 6.1 Same look and feel, morph by business function (the layer archetype system)

Today every one of the 14 canonical layers renders through the same template. That makes a finance layer and a brand layer look like the same page with different words. Fix this without breaking the unified feel.

The rule is: same skin, different bones. The global chrome stays identical across all layers, because that is what makes it one product, the top bar, navigation, the card system and tokens, the analyst's take line, the verified-versus-modelled annotations, the confidence pills, and the "How this was reasoned" strip. Those are the through-line and they never change shape.

What morphs is the body of the layer. Introduce a set of functional archetypes. Each archetype selects the layer's primary visualization (its hero) and the emphasis and order of its sections, reusing the existing components, the existing `heroes/` and `extras/` rich-visual slots, and the existing tokens. No archetype introduces a new colour, font, or card style. Map the 14 layers across roughly eight archetypes:

- **Performance scorecard** (trend lines, peer benchmark, KPI tiles): `business-performance`, `marketing-performance`, `competitive-intelligence`.
- **Financial bridge** (variance waterfalls, ratio tiles, margin walks): `finance`, `pricing-margin`.
- **Aging and collection** (aging buckets, DSO, risk-weighted balances): `receivables`.
- **Flow and funnel** (stage funnel, conversion, leakage points): `sales-pipeline`, `demand-intelligence`.
- **Distribution and sentiment** (sentiment and score distributions, share of voice, segment breakdown): `brand-social`, `customer-intelligence`.
- **Network flow map** (node and edge flow, lead times, fill rates, bottleneck highlight): `supply-chain`.
- **Cohort and people** (headcount, attrition cohorts, tenure distribution): `people-operations`, `talent-hr`.
- **Timeline and risk** (renewal and expiry timeline, value at risk on a horizon): `contract-management`.

Define the archetype-to-layer mapping in one place (a `layerArchetype` field on the structural metadata in `artifacts/portal/src/data/layers.ts`), so it is data, not branching logic scattered through components. A layer's archetype drives which hero renders, while the narrative, root causes, actions, feeds, confidence pills, and reasoning strip remain consistent across every archetype. Switching from finance to brand should feel like turning to a different chapter of the same report, not opening a different app.

---

## 7 · VERIFICATION AND ACCEPTANCE

At the end of the build, before declaring done:

1. `pnpm run typecheck` passes clean across all packages.
2. `pnpm run build` passes.
3. A fresh database plus `seed:demo` yields at least four `ready` tenants with distinct numbers and no shared anchor figure.
4. Registration is impossible without a valid PIN. Verify: a wrong PIN, an expired PIN, a revoked PIN, and a used-up PIN all fail with the same generic error. A valid PIN succeeds and decrements availability.
5. Only the owner can reach `/admin/pins` and `/admin/users`. A member account gets 403.
6. The owner bootstrap creates exactly one owner from env on an empty users table and is idempotent on reboot.
7. Every layer page renders the four-stage "How this was reasoned" strip with real per-tenant Confounder and Challenger output.
8. Express seed completes the priority set fully reasoned and clearly marks reduced layers; full seed runs all 9 sub-stages.
9. The full regression contract from Part 0 still works.
10. Each of the 14 layers renders its assigned functional archetype (finance shows a bridge, sales shows a funnel, supply chain shows a flow map, and so on), while the global chrome, navigation, and brand stay identical across all of them.
11. Confidence is present at every level: the layer header band, plus a per-element confidence pill on every metric, root cause, action, and claim, each with a basis of verified or modelled, populated for all demo tenants.
12. Em-dash sweep returns zero hits in user-facing prose and data.
13. Write the build report to `docs/build-report-v2.md`: what changed, the new tables and routes, the new env vars, the measured seed times before and after, the archetype-to-layer mapping, and any item you deferred with the reason.

---

## EXECUTION ORDER (the gates)

- **Phase A.** Ground yourself: read `replit.md`, `phase2.ts`, `anthropic.ts`, `gemini.ts`, the schema files, and the auth layer. Reply with a one-screen confirmation that you understand the system is a mini-Palantir reasoning layer, the regression contract, the em-dash rule, and the Day One Non-Negotiable above. List exactly which files you will touch for each later phase. Stop and confirm.
- **Phase B (the engine, built first).** Part 1, the three-model cortex and the real Confounder stage: the cortex config, the sub-stage split that inserts a genuine `confound` stage before `challenge`, the confounder schema and prompts, persistence of the confounder output, the per-layer reasoning-chain strip, and the architecture-page telemetry. Before declaring this phase done, seed at least one tenant end to end and show me real Confounder output and live cortex telemetry from that run. No stubs, no scripted data. Stop and confirm.
- **Phase C.** Part 2, PIN-gated auth (schema, routes, middleware, owner bootstrap, portal sign-in and Access console). Stop and confirm.
- **Phase D.** Part 3, fast-seeding engine (parallelism, caching, batching, resumability, express mode, pre-warm script). Report measured seed times before and after. Stop and confirm.
- **Phase E.** Part 4, world-class seed data (four-plus tenants, full depth, populated benches, including the ranked confounder list and challenger counter-arguments on every layer). Stop and confirm.
- **Phase F.** Part 5 and Part 6, bells and whistles plus design and mobile polish. Stop and confirm.
- **Phase G.** Part 7, full verification and the build report.

Begin with Phase A now. Phase B is the cortex and the confounder, and it ships before the auth front door. Do not proceed past any gate without my explicit confirmation.
