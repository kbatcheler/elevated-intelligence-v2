# Client onboarding runbook

How to bring a client organization onto Elevated Intelligence V2: from an empty
org to a client-admin who can self-serve, to read-only client-viewers who see
their own company's diagnosis and nothing else. Every step below uses surfaces
that already exist; nothing here grants standing access or widens a scope.

The roles referenced are the four seats from Phase D: `provider-owner` and
`provider-member` (the operator side), `client-admin` (a client's own
administrator), and `client-viewer` (a read-only client seat).

## The shape of it

The provider sets up the org and the company once, then hands the client a single
scoped PIN. From there the client onboards itself: the client-admin registers,
then mints viewer PINs for their colleagues, all fenced to their own org and the
viewer role. No client seat can ever reach the provider side or another org.

```
provider-owner                         client-admin                 client-viewer
  |                                        |                            |
  1. create client org                     |                            |
  2. seed / connect the tenant             |                            |
  3. bind tenant to the client org         |                            |
  4. mint a client-admin PIN  --- hand --> 5. self-register             |
     (scope: this org, client-admin)          (POST /api/auth/register) |
                                            6. mint viewer PIN --- hand-> 7. self-register
                                               (POST /api/client/           (POST /api/auth/register)
                                                viewer-pins)              8. read-only first run
```

## Step by step

### 1. Provider: create the client org

A provider-owner creates the client's organization (type `client`). A `client`
or `portfolio` org is what fences its members to a bound set of tenants; a
`provider` org sees every tenant, so the client must NEVER be a provider org.

### 2. Provider: seed or connect the client's tenant

Stand up the company the client will look at, in whichever data mode applies:

- Outside-in: seed the tenant from its public homepage ground truth, the same
  path the four reference tenants use.
- Connected: create the tenant in connected data mode, register the connectors,
  and run a connected refresh so `derived_signals` exist for the layers.

Either way the tenant must reach `ready` with real layers before a client sees
it, so the client's first run is honest rather than an empty shell.

### 3. Provider: bind the tenant to the client org

Bind the tenant to the client org (the `org_tenants` mapping). This bond is the
fence: a client seat sees exactly the tenants bound to its org and no others. A
portfolio client that should see several companies gets several bonds; a single
company client gets one.

### 4. Provider: mint a client-admin PIN

From the owner Access console (`POST /api/admin/pins`, owner only), mint one PIN
scoped to the client's org and the `client-admin` role, with a short expiry and a
small use count (a single-use PIN for one administrator is the norm). The PIN
code is shown once and never stored or returned again; hand it to the client's
administrator over a trusted channel.

### 5. Client-admin: self-register

The client's administrator registers with the scoped PIN
(`POST /api/auth/register`: email, password, PIN code). The PIN forces the new
account into the client's org and the `client-admin` role; the four PIN failure
modes (wrong, expired, revoked, used up) all return one byte-identical error, so
a bad or spent PIN reveals nothing. On success the use count decrements exactly
once.

### 6. Client-admin: mint viewer PINs (self-serve, fenced)

The client-admin onboards their own colleagues without going back to the
provider. From the client onboarding surface (`POST /api/client/viewer-pins`)
they mint client-viewer PINs. The scope is forced server-side to the
client-admin's OWN org and the `client-viewer` role: the request body may carry a
`scopeOrgId` or `scopeRole` only so a widening attempt is rejected loudly
(`scope_org_forbidden`, `scope_role_forbidden`) rather than silently overridden.
A client-admin can list (`GET /api/client/viewer-pins`) and revoke
(`POST /api/client/viewer-pins/:id/revoke`) only the viewer invites for their own
org. They cannot mint a provider PIN, an admin PIN, or a PIN for another org: the
whole `/api/client` router is gated to `client-admin` callers that belong to an
org, and there is no route there that touches the provider side.

### 7. Client-viewer: self-register

Each colleague registers with their viewer PIN exactly as in step 5. The PIN
forces them into the client's org and the read-only `client-viewer` role.

### 8. Client-viewer: the read-only first run

A signed-in client-viewer lands on their own company's intelligence and reaches a
diagnosis in two clicks, with honest loading, empty, and error states. What a
viewer sees and does not see is deliberate (the logged Phase T default):

- Sees: only the tenant(s) bound to their org; the diagnosis, the reasoning
  chain (layers, open questions, leading hypotheses, recommended moves), and the
  provenance.
- Does not see and cannot reach: any other tenant (404 or fenced), any
  provider-only route (403), cost and spend, connector internals, and the
  break-glass raw-signal path (refused even if a grant somehow existed).
- Read-only: a client-viewer reads the war room and the track record but cannot
  commit a move or advance an action. The server returns 403 on the action write
  routes for a viewer, and the war room hides the commit and status controls for
  a viewer rather than showing an affordance that would only fail. A client-admin
  acting on their own tenant, and the provider seats, may write the track record;
  the viewer is the read-only seat.

## What stays with the provider

The provider keeps everything that crosses the client fence: creating orgs,
seeding or connecting tenants, binding tenants to orgs, minting client-admin (and
any provider) PINs, the cost and observability surfaces, the connector internals,
and the Tier 3 security console and break-glass administration. The client-admin
self-serves viewers and nothing more; the client-viewer reads and nothing more.
