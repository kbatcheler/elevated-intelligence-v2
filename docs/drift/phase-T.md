# Phase T: client onboarding experience

Phase id: T. Name: Client onboarding experience. Milestone: yes. This is the third and final
phase of the owner-authorized autonomous R-S-T run, and it is itself the milestone hard stop,
so execution stops for owner review after this phase.

Adaptation note: the Operations prompt frames this stage as "add organizations", but
organizations, the four roles, scoped registration PINs, and per-tenant fencing already landed
in Phase D. Phase T therefore delivers what was actually missing on top of that base: a
client-admin can onboard their own read-only colleagues without the provider, the client side
has an honest first run, the read-only client-viewer seat is fenced off from everything that
crosses the client boundary, and the rollout is documented as a runbook. This phase added zero
npm dependencies and contains no em-dash or en-dash in source or in data.

## The embedded decision (logged for milestone review)

The plan left one product decision to apply and log: what a client-viewer may see. The applied
default is that a client-viewer sees the diagnosis, the full reasoning chain (layers, open
questions, leading hypotheses, recommended moves), and the provenance for their own bound
tenant, and nothing that crosses the client boundary: not cost or spend, not connector
internals, not any other tenant, not the Tier 3 break-glass raw-signal path, and (the one
addition this phase made beyond the plan's read list) not the action write surface. A
client-viewer is a strictly read-only seat. The reasoning: a client-viewer is the "show my
company's intelligence to a stakeholder" seat; writing the track record is an operator action,
and raw decrypted signals are the closest thing to a tenant's source data, which the client
boundary exists to fence off. Provider seats and the client-admin (on their own bound tenant)
remain the writers.

## What Phase T built

- `artifacts/api-server/src/lib/auth/inviteMinting.ts`: a shared `mintInvitePin` helper that
  factors the PIN minting (canonicalize, HMAC-hash, persist the invite row, return the one-time
  code) out of the owner admin route so the new client route and the owner route mint
  identically. `admin.ts` is refactored onto it with no behavior change (24 insertions, 49
  deletions).
- `artifacts/api-server/src/routes/client.ts`: a new `/api/client` router, session-gated and
  restricted to `client-admin` callers bound to an org. `POST /viewer-pins` mints a
  client-viewer PIN whose scope is FORCED server-side to the caller's own org and the
  `client-viewer` role; a body may carry a `scopeOrgId` or `scopeRole` only so a widening
  attempt is rejected loudly with `scope_org_forbidden` or `scope_role_forbidden`, never
  silently overridden. `GET /viewer-pins` lists only the caller's own-org viewer invites, and
  `POST /viewer-pins/:id/revoke` revokes only an own-org viewer invite (a PIN in another org or
  a non-viewer PIN in the same org returns 404, not a different error, so the route is itself a
  fence). No route on this router touches the provider side.
- `artifacts/api-server/src/routes/tenants.ts`: both action mutation routes
  (`POST /tenants/:id/actions` and `POST /tenants/:id/actions/:actionId/status`) now run after
  `requireTenantAccess` and the user check and return `403 { error: "forbidden" }` for a
  `client-viewer`, so a viewer bound to a tenant can read its war room and track record but
  cannot commit a move or advance an action. The status route also gained the user fetch it was
  missing. The GET actions route is unchanged (a bound viewer reads).
- `artifacts/api-server/src/routes/security.ts`: the break-glass human-signal read
  (`GET /security/tenants/:id/signals`) now refuses any non-provider role with a 403 before the
  grant check, so a client seat cannot reach a tenant's raw decrypted signals even when bound to
  the tenant and even if a grant somehow existed. Break-glass is a provider-side incident tool;
  this closes the one client-reachable path to source-like data.
- `artifacts/portal/src/lib/clientApi.ts`: a framework-free typed client for the three
  onboarding calls (list, mint, revoke), mirroring `adminApi.ts`: a 401 maps to an
  `unauthorized` outcome, a non-ok body surfaces the server error code (falling back to a
  generic error), an empty or missing list maps to a distinct `empty` outcome, and a thrown
  fetch maps to an error. It never invents data.
- `artifacts/portal/src/components/Onboarding.tsx`: the client-admin first-run surface (route
  `/onboarding`, shown only to `client-admin`), with honest loading, empty, ready, and error
  states: mint a viewer code (shown once), see the list of own-org viewer invites with the
  active versus revoked distinction, and revoke.
- `artifacts/portal/src/components/pages/WarRoomPage.tsx`: derives
  `canAct = user?.role !== "client-viewer"` from the auth context and hides the commit and
  status controls for a viewer, rendering "Read-only access" instead, so the UI never offers an
  affordance that would only 403 at the server.
- `artifacts/portal/src/components/Shell.tsx` and `TopNav.tsx`: the `/onboarding` route and nav
  item are added for the `client-admin` role only.
- `docs/client-onboarding-runbook.md`: the rollout runbook (provider creates the client org,
  seeds or connects the tenant, binds it to the org, mints a client-admin PIN; the client-admin
  self-registers, then mints viewer PINs fenced to their own org and the viewer role; each
  viewer self-registers into a read-only first run).

## The honesty constraint

The onboarding surface shows only persisted invite rows; a one-time PIN code is shown once at
mint and never stored or re-fetched (only its HMAC hash is persisted), so the UI never displays
a code it cannot prove it just generated. Empty, loading, ready, and error states are distinct.
The UI gating mirrors the server gate exactly rather than hiding a still-open capability: a
client-viewer is refused at the server on the action routes and the break-glass route, and the
portal simply does not offer those controls, so there is no affordance that silently fails. No
test was made to pass by weakening an assertion; the positive action-write tests were moved to a
genuinely authorized actor (a bound client-admin) rather than relaxing the gate.

## Acceptance checklist

1. A client-admin onboards a viewer into their own org and no further. Met: `client.ts` forces
   the mint scope to the caller's own org and the `client-viewer` role, and the integration
   suite proves a viewer PIN is minted into the admin's own org, an explicit matching scope is
   accepted, and a role-widening or org-widening attempt is rejected with `scope_role_forbidden`
   / `scope_org_forbidden`. Listing and revoke are fenced to own-org viewer invites (a
   cross-org or non-viewer PIN is 404).
2. Only a client-admin reaches the onboarding router. Met: the suite proves no session, a
   provider-owner, a provider-member, and a client-viewer each get the appropriate refusal, and
   a client-admin is forbidden from the owner-gated admin, spend, and operations surfaces.
3. A client-viewer sees only their own tenant, 403 on any provider route and any other tenant.
   Met (Phase D fencing re-verified plus the new gates): a bound client-viewer is 403 on the
   break-glass signal read, and the tenant-fencing tests still hold.
4. A client-viewer is read-only on the track record. Met: both action mutation routes return 403
   for a client-viewer (proven on a tenant the viewer CAN read, so it is the role gate, not
   tenant fencing), while a bound client-admin can commit and advance; the war room hides the
   controls for a viewer.
5. The client side has an honest first run with diagnosis in two clicks. Met: the Onboarding
   surface and the existing two-click diagnosis path render real persisted state with distinct
   loading, empty, ready, and error states; `clientApi` maps every outcome honestly.
6. The rollout is documented. Met: `docs/client-onboarding-runbook.md`.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 526 tests (api-server 227 across 30 files, portal 164, cortex 84,
  connectors 29, edge-agent 10, db 8, scripts 4). New this phase: 14 api-server tests in the
  client onboarding route integration suite plus 2 read-only proofs added to the tenants route
  suite (a client-viewer 403 on commit and on status to a tenant it can read), and 15 portal
  tests in `clientApi.test.ts`; the positive action-write tests were moved from a client-viewer
  to a bound client-admin actor.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, `.replit`, and `.github` is zero, and a database-wide cast over every text and
  jsonb column in every public table reports `TOTAL DASH HITS 0`.
- Zero new npm dependencies (the router reuses the existing invite-PIN machinery, the db, and
  workspace packages; the portal client uses the global fetch only).

## Logged drift and deviations

- The stage is "client onboarding experience", not "add organizations". Orgs, roles, scoped
  PINs, and tenant fencing landed in Phase D; T builds the self-serve onboarding, the client
  first run, and the runbook on that base rather than re-introducing the primitives.
- The client-viewer is read-only, which extends the plan's "sees diagnosis + reasoning +
  provenance" read list with an explicit write refusal on the action routes. This was the
  architect's recommendation on the first evaluate_task and is the logged milestone decision.
- Break-glass is now provider-only. Phase K bound the raw-signal read to "every role under an
  active grant"; Phase T narrows it to provider roles only, because a client boundary that
  fences off source data must also fence off the closest proxy for it. A client seat is refused
  before the grant check.
- `mintInvitePin` is a shared helper, not a new capability: the owner admin route and the new
  client route mint through the same code so they cannot drift apart; the client route's only
  difference is the forced own-org viewer scope.

## Gate

Phase T passed its architect `evaluate_task` review (PASS, no remaining HIGH or MEDIUM, after
the first review's HIGH on a writable client-viewer was fixed and re-verified). The drift index,
the rollup, and the V2 build report are updated to "A through T". This is the milestone hard stop
and the end of the owner-authorized R-S-T run: execution PAUSES for owner review after this phase
and does not auto-advance.
