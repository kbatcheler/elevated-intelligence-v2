---
name: Owner login recovery (dev and prod are separate DBs)
description: Why OWNER_* secrets alone may not yield a working PUBLISHED login, and the durable self-healing fix.
---

Symptom: user sets OWNER_EMAIL / OWNER_PASSWORD, the DEV login works, but the PUBLISHED
app still rejects the same credentials ("credentials were not recognized"). Note PINs are
not a workaround: they are shown once and only a hash is kept, never retrievable.

**Key environment fact (durable):** in this project dev and the published deployment use
SEPARATE Postgres databases. Production is seeded by a one-time clone of dev (schema AND
data) at first publish; a later republish syncs SCHEMA only, not data. So a dev-side data
write (e.g. resetting the owner's password) does NOT propagate to production. The
`executeSql` `environment:"production"` path is READ-ONLY (a replica) and proves the
divergence: the same user id can carry a DIFFERENT password hash in dev vs prod. There is
no agent-supported way to write the production database directly.

**Consequence for any prod-data invariant:** the only agent-reachable way to make a fact
true in the production database is to encode it in code that runs on the deployment at
startup, then have the user republish. The publish flow runs the deployment's own build and
boot, so startup reconciliation executes against the prod DB with the prod (global) secrets.

**The durable fix:** the owner bootstrap is self-healing, not create-only. On boot, if
OWNER_EMAIL/OWNER_PASSWORD are set it reconciles the user matching that email (create if
missing; otherwise repair role/status and reset the password only when the stored hash does
not verify), touching ONLY that one account. The env secret is the source of truth for the
configured owner. This is safe because there is no in-app owner password-change route, and
/register requires an invite PIN. After republish, the prod boot repairs the owner and login
works; the repair is idempotent on subsequent boots.

**Why not create-only:** the old "create only when zero provider-owner exists" guard meant a
prod DB that already held owners (from the first-publish clone, plus test-suite pollution
like `agent-test-*`, `*@example.com`) was never reconciled, so a newly set OWNER_PASSWORD
never took effect in production.

**How to apply:** make the startup reconciliation change in dev, verify dev login still
returns 200, then tell the user to Publish again; only the republish makes it take effect in
production. Owner secret values live in the agent bash shell, not the code_execution sandbox
(see replit-secret-isolation.md).
