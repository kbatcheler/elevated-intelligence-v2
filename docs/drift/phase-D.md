# Phase D: Auth, Orgs and Access

Verdict: Pass. PIN-gated self-registration, owner-minted and owner-scoped PINs,
client and portfolio tenant fencing, and an owner Access console are all built on
the Phase B schema with no migration, no new npm dependency, and no change to the
Confounder or telemetry code. The provider owner bootstraps from secrets, every
acceptance path is proven by an integration suite that runs the real app against
live Postgres, and the four PIN failure modes return one byte-identical error.

## Requirements checklist

- PIN-gated self-registration with owner-minted PINs. Done. `POST /api/auth/register`
  consumes an invite PIN in a single transaction: a conditional `UPDATE ... WHERE`
  the PIN is still valid `RETURNING` the row, then the user `INSERT`. No PIN, no
  account. `POST /api/admin/pins` mints codes for the owner only.
- Scoped PINs into org and role. Done. A mint may carry `scopeOrgId` and
  `scopeRole`; registration places the new user in exactly that org and role. An
  unscoped PIN falls back to the provider org and the default member role. Verified
  by the scoped-PIN integration test placing a `client-viewer` in the scoped org.
- Client and portfolio tenant fencing. Done. `assertTenantAccess(user, bindings)`
  is a pure predicate: provider roles see every tenant, a client role is fenced to
  its own org's tenants, and a portfolio role is fenced to its explicitly bound set.
  The fence guards every `/api/tenants/:id*` route (the runs, layer, and summary
  reads); there is no non-admin tenant list endpoint, so nothing enumerable leaks.
- Owner Access console. Done. The portal renders an owner-only console: PIN minting
  with copy-once display plus a list and revoke, a user list with disable and
  re-enable, and org creation with tenant binding.
- Passwords use the built-in scrypt. Done. Format `scrypt:N:r:p:salt:hash` with
  N=2^15, r=8, p=1; verification is constant-time over the raw digests.
- PIN codes hashed with HMAC-SHA256. Done. The code is hashed under a
  domain-separated key derived from `SESSION_SECRET`, stored in the unique
  `codeHash` column, and looked up directly by hash. No plaintext code is stored.
- Zero new npm dependencies. Done. Auth, sessions, hashing, and the integration
  harness use only the Node standard library and packages already present;
  `package.json` is unchanged.
- requireAuth reloads the user every request and rejects disabled. Done. The
  middleware verifies the cookie signature, then loads the user from the database
  on each request and rejects a disabled account, so a disable takes effect on a
  still-valid cookie. Proven by the live-cookie disable test.
- Login rejects disabled accounts. Done. A disabled account fails login with
  `account_disabled` even with the correct password.
- Routes mounted at the exact prefixes. Done. All auth routes live under
  `/api/auth/*` and all admin routes under `/api/admin/*`; the portal reaches them
  single-origin through the existing vite `/api` proxy.
- One generic error for all four PIN failure modes. Done. Unknown, revoked,
  expired, and used-up all return the identical status and body
  `{"error":"invalid_or_used_pin"}`. An integration test captures all four bodies
  and asserts they are byte-identical.
- Guard rails on disable. Done. The owner cannot disable their own account and
  cannot disable the last active provider-owner; both are blocked with a clear
  error and covered by tests.
- Emails are normalized. Done. Registration and login trim and lowercase the email,
  matching the bootstrap, so casing or stray whitespace never forks an identity or
  locks the owner out.
- Secrets never logged. Done. No log line carries a PIN code or a password; the
  mint log records only the PIN id and the creator.
- Confounder and telemetry untouched. Affirmed. No file under `lib/cortex` or the
  telemetry persistence path was modified in this phase; the Phase C suite still
  passes unchanged.

## Acceptance criteria

- Owner bootstraps. Met. On startup `ensureProviderOrgAndOwner()` created the
  provider org "Different Day" and one active provider-owner from the owner secrets;
  the database holds exactly one provider org and one active provider-owner, and the
  bootstrap is idempotent.
- A member registers only with a valid PIN, and reuse is rejected. Met. The
  valid-PIN test registers a `provider-member`, then the same code is refused as
  used-up.
- All four PIN failures give the same generic error. Met, byte-identical, see above.
- Members get 403 on admin. Met. `requireOwner` returns 403 `forbidden` to a
  non-owner member hitting an admin route.
- A client-viewer is fenced to its org tenant and a portfolio user to its bound set.
  Met. The fencing tests confirm a `client-viewer` sees only its org's tenant and a
  portfolio user sees only its bound tenants, with a 403 on anything outside.
- All checks green. Met. Typecheck across six projects, full build, and the whole
  test suite pass; em-dash sweep clean.
- Drift report and INDEX done. Met. This report plus the INDEX row for Phase D.

## Gate evidence

- Owner bootstrap, read back from the database: one provider org of type provider,
  one active user with role provider-owner. The startup path is idempotent and
  never overwrites an existing owner.
- Integration suite (18 tests, real app via `app.listen(0)` and native `fetch`
  against live Postgres): valid-PIN register then used-up reuse; unknown, revoked,
  expired, and used-up returning one identical error; scoped PIN placing a user in
  the scoped org and role; login of a disabled account rejected; a still-valid
  cookie rejected the instant the account is disabled; `requireOwner` 403 for a
  member; client and portfolio fencing; messy-email normalization. Data is unique
  per run and self-cleaning by email prefix.
- Live single-origin proxy: `GET /api/auth/status` with no cookie returns
  `{"authenticated":false}` through port 5000, confirming the portal reaches the API
  only via the `/api` proxy.
- Sign-in gate rendered on-brand (navy, gold, cream) in the preview.

## Drift items

- Acceptable: the live owner login could not be exercised from the agent's own
  shells. `OWNER_EMAIL`, `OWNER_PASSWORD`, and `SESSION_SECRET` are injected only
  into the workflow processes, not into the interactive shell or the code sandbox,
  which is the correct secret-isolation posture. The login and registration paths
  are instead proven end to end by the integration suite running the real app
  against live Postgres, and the owner's existence is confirmed directly in the
  database after bootstrap. For the same reason an authenticated-console screenshot
  is not capturable: there is no way to inject owner credentials into a static
  browser capture.
- Acceptable: the rate limiter is an in-memory fixed window, per process. It resets
  on restart and is not shared across instances. This is sufficient for the current
  single-instance dev and deploy target; horizontal scaling would need a shared
  store.
- Acceptable: PIN code hashes and session signatures both derive from
  `SESSION_SECRET`. Rotating that secret invalidates every outstanding PIN code and
  every live session cookie at once. This is the intended trade for zero new
  dependencies and is recorded here as a known operational caveat.
- Acceptable, same class as Phase B and C: hosted CI cannot run inside this Replit
  environment. The four steps run locally and pass, and the INDEX remains the
  protocol's source of truth for progress in place of per-phase git tags.

## Decisions taken

- scrypt parameters N=2^15, r=8, p=1, stored as `scrypt:N:r:p:salt:hash`. The
  parameters live in the stored string so a future cost bump can verify old hashes
  while minting new ones. Verification compares raw digests in constant time.
- PIN codes are hashed with HMAC-SHA256 under a key derived from `SESSION_SECRET`
  by domain separation, then stored in the unique `codeHash` column. A keyed hash
  with a unique column gives an indexed direct lookup at consume time rather than a
  per-row password-hash scan, which a per-code scrypt or bcrypt would force. The
  rotation caveat above is the accepted cost.
- The PIN code alphabet excludes the ambiguous 0, O, 1, and I, and codes are drawn
  by rejection sampling so the distribution stays uniform.
- Sessions are a self-contained HMAC-SHA256 token over `base64url(JSON{userId,
  role,iat})`, verified by SHA-256 digest comparison and a TTL, carried in the
  httpOnly `ei_session` cookie. No server-side session table is needed; the
  per-request user reload supplies the freshness that a stateless token lacks.
- All four PIN failure modes collapse to one status and one body. Distinguishing
  them would let a caller probe which codes ever existed or are merely spent, so the
  routes return `{"error":"invalid_or_used_pin"}` for every case.
- Email normalization trims and lowercases at the schema boundary and in code, to
  match the bootstrap. This closed a real latent gap: the bootstrap trimmed the
  owner email but login did not, and `email()` validation rejects surrounding
  whitespace, so an owner secret with a stray space would have been locked out.
- Zero new dependencies extends to testing: no supertest. The integration suite
  boots the real app on an ephemeral port with `app.listen(0)` and drives it with
  native `fetch`, injecting a test secret store, and cleans up by unique email
  prefix.
- All routes carry the `/api` prefix and the app trusts the proxy, so the per-IP
  login limiter sees the real client address through the existing vite `/api`
  forward; no proxy change was required beyond forwarding already in place.
- `POST /api/admin/users/:id/enable` is provided as the justified inverse of
  disable, so a member disabled by mistake can be restored without direct database
  surgery. It is owner-only like the rest of the admin surface.
- Portal UI scope is the gate plus the owner Access console only, with no router
  dependency: a single conditional shell switches between the gate, the dashboard,
  and the console based on session status and role.

## Test and verification summary

- Typecheck: clean across the six workspace projects.
- Build: portal to `dist/public`, api-server to `dist/index.mjs`.
- Tests: scripts 3, db 8, cortex 39, api-server 53, portal none, all pass. The 53
  api-server tests are password 6, pin 11, session 6, access 6, secret store 6, and
  the auth integration suite 18.
- Em-dash sweep: clean across artifacts and the drift docs.
- Live: owner bootstrap confirmed in the database; unauthenticated status read back
  through the single-origin proxy.

## Milestone marker

Phase D is not a milestone. Continuing to Phase E.
