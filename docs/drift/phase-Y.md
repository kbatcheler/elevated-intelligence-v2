# Phase Y: portfolio intelligence view

Phase id: Y. Name: Portfolio Intelligence View. Milestone: no. This is the opening phase of
the owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC), which pauses at the Stage 4/5
boundary for owner review (before Phase AD); the next protocol MILESTONE hard stop is AI at
the end of Stage 5. The "portfolio" org type already exists from Phase D, so this phase builds
ONLY the experience over it: a ranked multi-company board, cross-portfolio gap patterns, and a
drill-down into any bound tenant's full diagnosis. It added zero npm dependencies and contains
no em-dash or en-dash in source or in data.

The adaptation is that none of the access plumbing is new. The portfolio org type, the
`org_tenants` bindings, and the Phase T access posture (a caller never names a tenant outside
its own bindings, because it never names a tenant at all) already exist; Phase Y resolves the
portfolio scope server-side from the session alone and assembles a read over the tenants that
scope already permits. The deliverable is the board, the patterns, and the drill-down, not a
new fence.

## What was built

Server scope and the single read (`artifacts/api-server/src/routes/portfolio.ts`,
`GET /api/portfolio/summary`, mounted under the shared `requireAuth` gate in `app.ts`):

- Scope is resolved from `req.user` alone, never from anything the client sends. A provider
  seat sees every tenant as a portfolio (`scope.type = "provider"`); a seat whose `orgType` is
  `portfolio` and that has an `orgId` sees only the tenants its org is bound to through
  `org_tenants` (`scope.type = "portfolio"`); every other seat (a client org, or a user with
  no org) is refused with `403 portfolio_only`, and a missing session is `401`. A portfolio
  caller can never reach a tenant outside its bindings because it never names a tenant; the
  binding set IS the query.
- An empty binding set is an honest empty board (`summarizePortfolio(scope, [])`), not an
  error.
- The read fans out (in one `Promise.all`) over only the in-scope tenant ids: the tenant rows,
  the layer catalogue, the persisted `tenant_layers` content, the `committed_actions`, and the
  `outcome_measurements` joined back to their actions. Every jsonb projection is defensive (a
  malformed stored value becomes null, never a fabricated stand-in), mirroring the tenants
  router posture.

Pure portfolio math (`artifacts/api-server/src/lib/portfolio/portfolioMath.ts`, unit-tested,
no database or request needed):

- It ranks each bound tenant by realized-and-at-risk value and open-gap severity so the worst
  and best surface to the top, counts open gaps by severity (high/medium/low with a derived
  severity score), and rolls the per-tenant outcome summary (computed via the shared
  `computeOutcomeSummary` over real committed actions and outcome measurements) into portfolio
  totals.
- Every dollar figure is nullable. A company with no currency-anchored prediction or no
  measurement carries a null `valueIdentifiedUsd` / `valueRealizedUsd` / `unrealizedValueUsd`,
  never a fabricated zero. The totals expose `tenantsWithLayerContent` and `tenantsWithOutcomes`
  so the board can say honestly how many companies actually have the data behind a figure.
- Cross-portfolio gap patterns are derived only from persisted tenant-layer gaps and only
  appear for a gap shared by at least two tenants ("N of M companies have ..."), carrying the
  affected and total tenant counts, the share, a derived severity, the affected tenant ids, and
  example descriptions. A gap unique to one company is not promoted to a pattern.

Auth payload (so the portal can offer the surface without a second round trip):

- `middleware/auth.ts` now left-joins `orgs` when it loads the session user and exposes
  `orgType` on `AuthedUser`. `routes/auth.ts` returns `orgType` on the register, login, and
  status payloads via a small `orgTypeFor()` helper. This is a navigation hint only; the server
  still fences the portfolio data by the session binding, never by this field.

Portal (`artifacts/portal/`):

- `lib/portfolioApi.ts` returns a discriminated union (`{ unauthorized }` | `{ forbidden }` |
  `{ state: "ready", data }` | `{ state: "error" }`), mapping 401 and 403 to their own honest
  states rather than an empty board.
- `components/pages/PortfolioPage.tsx` is a state machine over that union: it renders the ranked
  company board (value identified vs realized, unrealized/at-risk, overall confidence, and the
  count and severity of open gaps, worst-first), the cross-portfolio patterns, and a drill-down
  that binds the chosen tenant (`setCurrentId`) and navigates to the per-tenant brief, reusing
  the unchanged tenant diagnosis. Null dollar figures render as a dash through `formatUsd`,
  never as `$0`. Loading, empty, ready, forbidden, and error states are distinct.
- `types.ts` gains `OrgType` and the portfolio types mirroring the server shape exactly;
  `Shell.tsx` routes `/portfolio` with NO client-side role gate (the server fences and the page
  renders the forbidden state); `TopNav.tsx` shows the Portfolio link only for a provider or a
  portfolio seat.

## Acceptance evidence

- Ranked view renders from persisted state: the integration test seeds layers, tenant_layers,
  committed_actions, and outcome_measurements and asserts the ranked tenant list, the totals,
  and the worst-first ordering.
- Cross-portfolio patterns render: the test asserts a gap shared by multiple seeded tenants
  surfaces as a pattern with the right affected/total counts and that a single-tenant gap does
  not.
- Drill-down works: the page binds the selected tenant and navigates to the existing per-tenant
  diagnosis (compile-verified end to end; the diagnosis surface itself is unchanged).
- 403 outside the portfolio: the test asserts a non-portfolio, non-provider seat receives
  `403 portfolio_only`, a provider receives all tenants, and a portfolio seat receives only its
  bound tenants (plus the `401` unauthenticated case).
- No fabricated figures: portfolio math emits null dollar figures when there is no real number
  behind them, and `formatUsd` renders null/non-finite as a dash, proven by the math unit tests.

## Verification

- Typecheck green across all four workspace projects (exit 0).
- Build green (exit 0; portal 1746 modules, api-server bundled).
- Full suite green at 646 tests: api-server 334 across 39 files (the new `portfolioMath` unit
  tests and the portfolio integration tests, +19 over Phase X), portal 177 across 14 files,
  cortex 84, connectors 29, edge-agent 10, db 8, scripts 4.
- Long-dash sweep zero on BOTH sides: a fresh `rg` over the authored tree (lib, artifacts,
  docs, scripts, replit.md, .replit, .github) returns zero, and a database-wide cast over every
  public text and jsonb column (118 columns; Phase Y added no schema, so the column set is
  unchanged) reports `TOTAL DASH HITS 0`.
- Zero new npm dependencies.

## Logged drift and deviations

- The `/portfolio` Shell route carries NO client-side role gate. This is deliberate: the server
  resolves portfolio scope from the session and returns `403 portfolio_only` for any
  non-portfolio, non-provider seat, which the page renders as an honest forbidden state. A
  client seat that types the URL sees that panel rather than a hidden NotFound. The TopNav link
  is hidden from a client seat as an affordance, but authorization is the server's, not the
  nav's.
- No dedicated portal unit test for `PortfolioPage` / `portfolioApi` (the only non-blocking item
  from the architect `evaluate_task` review). The server integration tests carry the main
  functional and authorization coverage, and the portal path is compile-verified and
  straightforward (`setCurrentId` then `navigate("/")`). Logged as accepted drift; a future
  lightweight portal test can cover the forbidden and ready rendering and the drill-down.
- The portfolio fences to bound tenants by reusing the Phase T access posture (the binding set
  is the query); no new access primitive was introduced.

## Gate

Phase Y passed its architect `evaluate_task` review (PASS: server-side fencing is enforced
independently of the no-role-gate client route, the null/dash honesty boundary holds end to
end, and no high-severity correctness, security, or constraint violation was found; the one low
item is the missing portal unit test logged above). The drift index, the rollup, and the V2
build report are updated to "A through Y". Phase Y is NOT a milestone; per the owner-authorized
Stage 4 run, execution continues to Phase Z and does not pause here (the pause is at the
Stage 4/5 boundary before Phase AD).
