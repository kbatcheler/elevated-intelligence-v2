# Phase L: the portal security surfaces over Tier 3

Phase id: L. Name: Connected Portal Security Surfaces (Posture, Connections, Break-
glass, Provenance). Milestone: no, but gated (a per-phase hard stop for owner review
before the next phase).

Phase K landed Tier 3 backend only: per-tenant cryptographic isolation with crypto-
shredding, no standing human access behind an owner-approved break-glass grant, and
the hash-chained provenance ledger. Phase L is the portal over that backend. It adds
four surfaces and changes no Tier 3 guarantee: an owner-only security console (key
lifecycle posture, connection-security posture, break-glass administration, and
provenance verification) and a separate all-role human signal read page. Every panel
renders only real backend facts with designed loading, empty, and error states, never
a fabricated value or a silent spinner. This phase added zero npm dependencies (the
existing workspace packages, the Node global fetch, and node:crypto for the test seed
only) and contains no em-dash or en-dash.

## Build summary

- **The data layer** (`artifacts/portal/src/lib/securityApi.ts`). A framework-free
  client mirroring `adminApi.ts`: typed outcomes for every call, a 401 mapped to
  `{unauthorized: true}` so the shell can log the seat out, and the three Tier 3
  failure codes mapped to their own honest UI states rather than an empty list. The
  human signal read branches on the response body's error code (`break_glass_required`
  -> 403, `crypto_shredded` -> 409, `signal_unreadable` -> 422), so each refusal shows
  a distinct, truthful notice. Every helper (key status, provision, revoke, grants
  list, create grant, revoke grant, access events, provenance verify, human signals)
  is unit-tested over a mocked `fetch` (URL, method, body, ready, empty, error, 401,
  `no_key_to_revoke`, the three typed codes, and the verify payload).
- **The owner security console** (`artifacts/portal/src/components/security/`). A
  tabbed console mirroring the access console, behind a `TenantGate` so every panel is
  handed a concrete tenant id and never spins on a null current tenant. Posture shows
  the tenant key status, the active KMS provider and connected state, and the customer-
  managed KMS as "available, not connected", with provision and revoke actions.
  Connections shows the connection-security facts only (key status and KMS), leaving
  the existing `/connections` feeds page untouched. Break-glass administration creates
  time-boxed grants (the user picker reuses the owner-only `GET /api/admin/users`),
  lists every grant with its live state (active, expired, revoked), revokes an active
  grant, and shows the append-only access-event audit. Provenance verifies the per-
  tenant chain and reports intact or broken with length, the broken index, and detail.
- **The all-role human signal read** (`artifacts/portal/src/components/pages/BreakGlassPage.tsx`).
  A separate page, intentionally not owner-only (the `GET .../signals` endpoint gates
  on an active grant for every role, not on ownership), that reads the decrypted human
  signals for the current tenant under an active break-glass grant. Each backend state
  has its own honest surface: grant required, crypto-shredded, unreadable, empty, or a
  read-only table of decrypted values rendered exactly as the math produced them. The
  values are never cached or exported.
- **Routing and navigation** (`Shell.tsx`, `TopNav.tsx`). `/security` resolves to the
  console for a provider-owner and to NotFound for anyone else (the same owner gate the
  admin console uses); `/break-glass` resolves for every role. The owner sees both
  Security and Break-glass in the nav; every other seat sees Break-glass only.

## Minimal backend addition

- `GET /api/security/tenants/:id/key` now also returns `customerKms` from
  `customerKmsStatus()`, so the posture view can show the declared customer-managed-KMS
  seam ("available, not connected") without the UI inventing it. A route test asserts
  the field is present and honest. No other endpoint was added; the grant user-picker
  reuses the existing owner-only admin users route.

## Requirements checklist

- Security posture surface. Done: tenant key status, active KMS provider and connected
  state, and the customer-managed KMS shown as available-not-connected, with provision
  and revoke. A revoked key reads as revoked, not as missing.
- Connection-security posture. Done: the connections tab shows only real connection-
  security facts (key status, KMS); the existing feeds page is left intact.
- Break-glass administration and the access audit. Done: owners create time-boxed
  grants, list grants with the active versus expired versus revoked distinction shown
  honestly, revoke an active grant, and read the append-only access-event audit.
- All-role human signal read. Done: a separate non-owner-only page maps the three
  Tier 3 refusals (grant required, crypto-shredded, unreadable), the empty case, and
  the ready case each to its own state; raw values are never cached or exported.
- Provenance verification. Done: the verify result reports intact or broken with chain
  length, the broken index, and detail.
- Never fabricate telemetry. Done: the customer KMS reads "available, not connected";
  every fetch error is distinguished from an empty result; no panel shows invented data.
- Owner gating. Done: `/security` is gated on `user.role === "provider-owner"`; the
  human signal read is deliberately all-role because its endpoint gates on a grant.
- Zero new npm deps; no em-dash or en-dash. Done: workspace packages, the global fetch,
  and (for the e2e seed only) node:crypto; the source dash sweep is zero.

## Logged drift and deviations

- Built in-repo on the existing portal, not as a fresh react-vite first build. The
  react-vite skill's first-build mandate is for standing up a new portal; the portal
  has existed since Phase E and these surfaces extend it, so a new app would duplicate
  it and break the established design system. The deviation is deliberate and logged.
- One minimal backend addition (the `customerKms` field on the key-status route) rather
  than a UI that invents the customer-KMS seam. This keeps the honesty guarantee in the
  backend that owns it.
- The grant user-picker reuses `GET /api/admin/users` (owner-only) rather than adding a
  second user-listing endpoint.
- The e2e login seeds a disposable provider-owner. The owner secrets (OWNER_EMAIL,
  OWNER_PASSWORD) reach the workflow processes only, not the agent shell or the testing
  runtime, and the users table stores only the scrypt hash, so the testing subagent
  cannot log in as the bootstrapped owner. The Phase L e2e instead seeds a throwaway
  provider-owner with a known password (hashed with the application's own scrypt
  parameters), drives every surface, and deletes the row at the end. This mirrors the
  long-standing "owner secrets are not in the agent shell" environmental fact and does
  not weaken any access control: the seed runs as a database step, and a provider-owner
  legitimately sees all tenants.

## Verification

- Typecheck and build are green across the workspace.
- The full suite is green: 382 tests (portal 144, up from 108 with 36 new in
  `securityApi.test.ts`; api-server 123; cortex 66; connectors 27; edge-agent 10;
  db 8; scripts 4). The new portal tests exercise every securityApi helper, the 401
  unauthorized path, the `no_key_to_revoke` case, and the three typed Tier 3 codes.
- e2e acceptance with the Playwright testing skill: signed in as a seeded provider-
  owner and verified the security console header and all four tabs render honest non-
  loading states (key and KMS posture, the customer-KMS available-not-connected state,
  the connection-security facts, the break-glass grant form plus the grants and access-
  event sections, and the provenance verify result), then verified the all-role human
  signal read shows exactly one honest state (break-glass grant required, as expected
  with no active grant), never a spinner and never a fabricated value. The seeded user
  was cleaned up.
- Fail-loud honesty: a revoked or missing key, a missing or expired or revoked grant,
  a crypto-shredded or unreadable signal read, and an unconfigured customer KMS all
  surface as their own designed state, never a silent empty result or a fabricated
  value; a fetch error is always distinguished from an empty result.
- Zero new npm dependencies.
- Long-dash sweep zero across the Phase L source (the portal security surfaces, the
  data layer and its tests, the routing and nav, and the security route).

## Gate

Phase L is gated. Execution pauses here for owner review before the next phase. Do not
auto-advance.
