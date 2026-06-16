---
name: Functional e2e auth strategy
description: How to drive authenticated browser/e2e tests when owner secrets are not in the agent shell
---

# Authenticated e2e in this repo

The whole authenticated portal (the Shell) renders only after a real login. The only
unauthenticated surfaces are the Gate (Login/Register) and the public shared diagnosis at
portal route `/d/:token` (which renders OUTSIDE the AuthProvider).

## Constraint
`OWNER_EMAIL`, `OWNER_PASSWORD`, and `SESSION_SECRET` are injected into the workflow
processes only, never into the agent shell or a Playwright test. So you cannot type the
owner password, cannot mint an invite PIN (its codeHash is derived with SESSION_SECRET),
and cannot forge the `ei_session` cookie (it is an HMAC over SESSION_SECRET).

## How to test authenticated flows (the sound approach)
Seed a NEW `users` row directly in the dev DB with a scrypt passwordHash you generate for
a known plaintext, then log in through the REAL sign-in form. Password hashing (scrypt,
stored as `scrypt:N:r:p:saltB64:hashB64`, with N=1<<15, r=8, p=1, keylen=64, 16-byte salt,
maxmem 64MiB) embeds its own random salt and does NOT use any app secret, so a hash
generated outside the app verifies correctly. The server then issues a real `ei_session`
signed with its own SESSION_SECRET, exactly like production.

**Why:** this is the only faithful way to reach authed surfaces without the platform
secrets, and it exercises the real login + cookie + requireAuth path instead of bypassing
it. Cookie-forging and PIN-minting are dead ends precisely because they need SESSION_SECRET.

## How to apply
Insert: email (lowercase, unique), display_name, password_hash, role, status='active',
org_id = the bootstrapped provider org (`SELECT id FROM orgs WHERE type='provider'`).
- role `provider-owner` for owner-only consoles (`/admin`, `/security`, `/spend`).
- role `provider-member` for provider-only-but-not-owner checks (provider seats are not
  tenant-fenced; they see all tenants).
- For client/portfolio seats: create an org of type `client`/`portfolio`, role
  `client-admin`/`client-viewer`, and bind tenants via `org_tenants`. Non-provider seats are
  tenant-fenced by `requireTenantAccess`; the portfolio surface keys off orgType='portfolio',
  not a special role.

The dev DB is SHARED with the regression suite, so use unique emails and DELETE the seeded
rows when finished; never assert on global counts. Delete users BEFORE their client org
(users.org_id has an FK); deleting the org cascades its org_tenants bindings.

## Verifying API-level fences from the browser
To assert a server-side fence (e.g. tenant fencing) inside a Playwright test, navigate the
browser DIRECTLY to the raw GET endpoint (e.g. `/api/tenants/:id/overview`). It is same-origin
through the Vite `/api` proxy, so the httpOnly `ei_session` cookie rides along automatically,
and the JSON body / status is visible to assert on. A client bound only to tenant A sees just A
in `/api/tenants`, gets a 403 `{"error":"forbidden"}` on an unbound tenant's overview, and 200
on its own. This needs no app secret and no XHR plumbing in the test.
