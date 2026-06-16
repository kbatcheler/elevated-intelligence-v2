# Post-AI functional and end-to-end verification

Date: 2026-06-16. Scope: a complete drift report at the Phase AI milestone (Stage 5, Platform
completion, complete and PAUSED), in response to the owner request to "do a complete drift report."
This is a VERIFICATION audit pass, not a new phase: it mints no Phase AJ, advances no gate, and adds
no product surface. It records what was verified end to end through a real browser, the fresh gate and
two-sided long-dash evidence, the previously accepted or deferred items it leaves untouched, and the
owner-rerun boundary that remains.

## Method

- Engaged the architect (`responsibility: plan`) to shape a progressive end-to-end strategy before any
  testing; PASS. It confirmed that authenticated browser testing must seed a dev `users` row with a
  self-generated scrypt hash and log in through the real form, because the owner secrets and
  `SESSION_SECRET` reach only the workflow processes, so forging a session cookie or minting a PIN is
  impossible from the test runtime.
- Drove the REAL application in a browser with the Playwright testing skill across four flows
  (unauthenticated surfaces, an authenticated provider-owner smoke, a provider-member negative, and a
  client-admin negative with tenant fencing). Every seeded row was created with ASCII-only data and
  DELETED after the flow, returning the shared dev database to baseline. The client-admin flow also
  seeded a fresh client org and its `org_tenants` binding, not only a user row; the user rows were
  deleted before their org (a `users.org_id` foreign key) and dropping the org cascaded its bindings, so
  zero seeded users, orgs, and bindings remained.
- Re-ran the regression gates through the configured workflows: `typecheck`, `build`, and the full
  `test` suite. All three exit 0.
- Re-ran the two-sided long-dash sweep on both sides of the boundary the hard constraint draws. The
  source guard (`scripts/src/emDashGuard.ts`) runs inside the green suite and reports zero. A fresh
  database-wide sweep cast every public base-table text and jsonb column to text and matched both the
  em-dash and the en-dash: 144 columns across 37 base tables that carry such columns (of 39 base tables
  total), zero on both sides.

## What was verified end to end (through a real browser)

Honest distinction: these are Playwright browser flows run via the testing skill, NOT additions to the
vitest suite. The vitest suite is unchanged at 888. These flows exercise the real portal plus API plus
Postgres over the dev workflows.

1. Unauthenticated surfaces. The sign-in gate renders; an invalid login returns the honest "those
   credentials were not recognized" state rather than a crash or a silent pass; the register toggle
   works; and the public shared diagnosis at `/d/:token` renders an honest unavailable state outside
   the AuthProvider, with no crash, no fabricated diagnosis, and no sign-in gate.
2. Authenticated provider-owner smoke. A seeded provider-owner logs in through the real form (which
   proves the cookie issuance and the Vite `/api` proxy path work in a browser end to end), passes the
   one-time boot splash, and the shell, brief, and layers render; the owner-only Admin, Security, and
   Spend consoles each load without a 403 or a crash.
3. Provider-member negative (owner-gating is role-precise). Owner-only `/admin`, `/security`, and
   `/spend` each render the honest NotFound ("This surface does not exist."), while the
   provider-allowed `/connections` DOES render, which proves the block is owner-precise rather than a
   blanket denial; the app never falls back to the sign-in gate after authentication.
4. Client-admin negative and tenant fencing. Owner-only AND provider-only routes (`/admin`,
   `/security`, `/spend`, `/connections`, `/break-glass`) all render the honest NotFound, while the
   client-admin `/onboarding` surface DOES render as the positive control. Server-side fencing holds:
   `GET /api/tenants` returns only the org's bound tenant and not an unbound one; the unbound tenant's
   overview returns 403 forbidden; the bound tenant's overview returns 200. The fence was asserted by
   navigating the browser directly to the raw `/api` GET endpoints, which carry the httpOnly session
   cookie same-origin through the proxy, so the assertion needs no app secret.

## Posture summary (what holds)

The hard constraints all hold at verification time:

- Zero new npm dependencies. This pass changed no product code; its only artifacts are these drift
  records and one agent memory note.
- ASCII hyphen only, enforced on both sides: the source guard in the green suite and a fresh
  database-wide row sweep both read zero.
- No fabricated telemetry or output: every blocked surface shows an honest, distinct NotFound; the
  fence returns a real 403; and the invalid-login and unavailable-share states are honest and distinct
  from loading and empty.
- Per-tenant access is enforced by the single pure predicate `canAccessTenant` behind
  `requireTenantAccess`, confirmed live: a client seat reaches only its `org_tenants`-bound tenants.

## No defects found; no remediation actioned

Unlike the post-X audit, this pass found no in-scope defect: every gated surface and the tenant fence
behaved exactly as the access model specifies. No product code was changed.

## Areas accepted or deferred (unchanged from post-X, restated)

The accepted and deferred items from `audit-post-X.md` and `rollup.md` are unchanged and were not
re-actioned here: the in-memory auth rate limiter (D), the per-process connector token buckets (O), the
`SESSION_SECRET` coupling (D), the local KMS being a software key store rather than an HSM (K), the
provenance append-only enforced at the application layer rather than the database role (K, M), the
absence of a live oauth2 runtime (O), the per-instance `LAYER_CONCURRENCY` operational fact (AH), and
the Stage 5 owner-rerun boundaries (the sovereign real-endpoint full seed of AF and the Docker build,
full in-container seed, live cloud run, and `terraform apply` of AH). Each carries its operator action
in `docs/deploy-readiness.md` and the per-phase reports.

## Recurring environmental facts (not fixable in code)

- Owner secrets and `SESSION_SECRET` reach the workflow processes only, not the agent shell or the test
  runtime, so an authenticated browser flow is reached by seeding a dev `users` row with a
  self-generated scrypt hash (the hash carries its own salt and uses no app secret) and logging in
  through the real form. Interactive owner login and any flow needing real model spend remain the
  owner-rerun boundary.
- Hosted CI cannot execute inside this environment; the gate steps run locally through the workflows
  and pass, the same evidence the hosted job would produce.
- No manual git tags: Replit manages version control through automatic checkpoints, so
  `docs/drift/INDEX.md` is the progress source of truth.

## Evidence

- `typecheck` exit 0; `build` exit 0 (portal 1756 modules, api-server bundled to `dist/index.mjs`);
  `test` exit 0, the full suite green at 888 tests (api-server 493, portal 234, cortex 110, connectors
  29, edge-agent 10, db 8, scripts 4), unchanged because this pass added no test and changed no product
  code.
- Source dash guard: zero (in the suite). Fresh database-wide sweep: zero on both the em-dash and the
  en-dash across 144 public text and jsonb columns over 37 base tables that carry such columns (of 39
  base tables total).
- Browser console clean across the flows (only the Vite dev connect lines).
- Four Playwright end-to-end flows via the testing skill: all PASS, each seeded row cleaned up, the dev
  database returned to baseline.

## Verdict

The platform is in a sound state at the Phase AI milestone hard stop, now corroborated by real-browser
functional and end-to-end verification of the unauthenticated surfaces, the authenticated owner
consoles, and the role and tenant access fences, on top of the green suite and the two-sided zero
long-dash sweep. No defect was found and no product code changed; the remaining items are the
previously accepted or deferred operator actions and the Stage 5 owner-rerun boundaries. This audit
advances no gate and mints no phase; Phase AI remains the milestone hard stop and the build does not
auto-advance.
