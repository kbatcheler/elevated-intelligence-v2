---
name: Owner login recovery on the shared DB
description: Why setting OWNER_* secrets alone may not yield a working login, and how to recover one safely.
---

Symptom: user sets OWNER_EMAIL / OWNER_PASSWORD, restarts, still cannot log in (and
"what is the invite PIN?" - PINs are shown once and only a hash is kept, never
retrievable).

Root cause: the owner bootstrap is CREATE-ONLY-WHEN-ZERO provider-owner exists. If the
users table already holds owners (commonly test-suite pollution like `agent-test-*`,
`sectest-*`, `*@example.com`, plus a real owner), bootstrap silently skips, so newly
added OWNER_* secrets never create a login.

**Why:** "exactly one way in" is a deliberate design - bootstrap must not clobber an
existing owner. The cost is that a polluted owners table blocks new-owner creation.

**How to apply (recovery):** provision/reset an owner directly rather than relying on
bootstrap. Non-destructive path = upsert by email: INSERT ... ON CONFLICT (email) DO
UPDATE SET password_hash, role='provider-owner', status='active', org_id. Hash with the
app's exact scrypt format (`scrypt:N:R:P:saltB64:derivedB64`, see the auth password
lib; must set maxmem or N=2^15 throws). Self-verify by re-reading the stored hash and
re-running scrypt against the provided password before declaring success, then prove the
real path with a `POST /api/auth/login` returning 200 + session cookie.

**Critical environment fact:** dev and the published deployment share ONE physical
Postgres - the deployment inherits the single DATABASE_URL secret - so a dev-side DB
write fixes the published app too. The `executeSql` `environment:"production"` path is a
READ-ONLY view of that same database (it shows the same rows), not a separate DB.

Tooling note: the secret values live in the agent bash shell (global secrets), not the
code_execution sandbox, so run the provisioning script from bash. Under pnpm's strict
layout `pg` is not resolvable from `.local/`; resolve it with
`createRequire("/abs/path/to/lib/db/package.json")` since `lib/db` depends on `pg`.
