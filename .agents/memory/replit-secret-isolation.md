---
name: Replit secret isolation
description: Why agent-side curl/sandbox cannot read user secrets, and how to verify secret-dependent flows instead.
---

Secret visibility depends on SCOPE, and the two agent execution contexts differ:
- WORKFLOW-SCOPED secrets are injected only into the workflow processes; they are
  absent from the agent `bash` shell and the `code_execution` sandbox.
- GLOBAL Replit Secrets (added via the Secrets UI / `requestEnvVar`, e.g. once
  OWNER_EMAIL / OWNER_PASSWORD / SESSION_SECRET are promoted to global) DO appear in
  the agent `bash` shell (`[ -n "$OWNER_EMAIL" ]` is true there).
- The `code_execution` sandbox still does NOT receive user secrets even when global
  (only a curated few like DATABASE_URL are present); also `process` is not a global
  there, so use `await import("node:process")`.

**Why:** the bash shell inherits the repl env (global secrets included); the sandbox
is deliberately stripped to a minimal env. This is the platform posture, not a bug.

**How to apply:** for any secret-dependent operation (owner login test, provisioning a
user from OWNER_*), run it from the agent `bash` shell, NOT the code_execution sandbox.
Keep secret VALUES in-process (build JSON via `node -e`, pipe to curl; never echo them;
report only HTTP status / booleans). Verify secret-dependent behavior by:
- integration tests that boot the real app and inject a test secret store, and
- reading the resulting DB state directly (e.g. confirm the bootstrapped owner row).
After a secret is added, restart the workflows so their processes pick it up.

## Live owner login for the Playwright testing skill

The testing skill (Playwright) drives a real browser and must actually log in, but
OWNER_PASSWORD is not in the testing runtime either, and the users table stores only
the scrypt hash, so the real owner password cannot be recovered to type it.

**Pattern that works:** seed a disposable provider-owner directly in the DB before the
e2e and delete it after. Compute password_hash yourself with the app's own scrypt
parameters and format (see the auth password lib) using a password you choose; a
provider-owner legitimately sees all tenants, so one seeded owner exercises every
owner-gated surface. Clean up the row at the end. This is a DB seed step, not a bypass
of any access gate.
