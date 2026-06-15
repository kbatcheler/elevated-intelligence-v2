---
name: Secret-in-URL redaction chokepoint
description: Why any route that carries a secret/bearer in its URL path must be redacted at one shared chokepoint before observability capture.
---

Rule: A URL path segment that IS a secret (a bearer share token, an opaque
credential) must never reach an external observability sink. There is ONE shared
chokepoint that collapses such a path to its route template before the global
error handler attaches `req.path` to the capture context. Any new secret-in-URL
route adds its pattern to that single function, never a second per-handler seam.

**Why:** The public share-link route exposes the bearer token in the URL path
(`GET /api/public/diagnosis/:token`). The unhandled-error handler forwarded
`req.path` into the Sentry-compatible reporter context, so a failure deep in a
public request could leak a live or attempted token to an external sink even
though the database correctly stores only the token's sha256 hash. The architect
flagged this as HIGH; the fix was a single redaction function plus a regression
test that the token substring never survives.

**How to apply:** When you add ANY route whose path contains a credential or
bearer (not an opaque-but-public id), extend the redaction chokepoint
(`artifacts/api-server/src/lib/observability/redactRoute.ts`) with the new
pattern and assert in a test that the secret substring is gone after redaction.
Do not redact ad hoc inside the handler, and do not rely on storing only the hash
in the DB: the leak vector is the URL in the error/observability path, which is
independent of how the secret is persisted.
