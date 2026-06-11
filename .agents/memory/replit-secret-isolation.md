---
name: Replit secret isolation
description: Why agent-side curl/sandbox cannot read user secrets, and how to verify secret-dependent flows instead.
---

User-managed Replit secrets (env vars set via the Secrets UI, e.g. OWNER_EMAIL,
OWNER_PASSWORD, SESSION_SECRET) are injected into the workflow processes when those
workflows start, but they are NOT present in:
- the agent `bash` tool's shell (`echo $OWNER_EMAIL` is empty there), and
- the `code_execution` sandbox (`process.env` is undefined / stripped).

**Why:** this is the platform's secret-isolation posture, not a bug. It prevents the
agent from reading or leaking user credentials.

**How to apply:** do not try to curl or fetch a secret-gated flow (e.g. owner login)
from the agent shell or sandbox and expect it to work; the request will fail with
empty credentials (often a 400 validation error on an empty field), which looks like
an app bug but is not. Verify secret-dependent behavior instead by:
- integration tests that boot the real app and inject a test secret store, and
- reading the resulting DB state directly (e.g. confirm the bootstrapped owner row).
After a secret is added, restart the workflows so their processes pick it up.
