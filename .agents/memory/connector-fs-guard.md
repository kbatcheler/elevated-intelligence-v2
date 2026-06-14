---
name: Connector derive-and-discard and the fs guard
description: How the V2 connector extraction path stays out of the data-at-rest scope, and why the runtime fs guard is only a tripwire.
---

# Connector derive-and-discard and the fs guard

Covers `lib/connectors` extraction, the edge agent, and the no-write guard.

## The derive-and-discard rules (do not break these)
- The extraction path imports `@workspace/db/contracts` ONLY, never the db root.
  Importing the db root opens the application Postgres pool as a side effect, which
  would give a connector a handle to our store. Enforced by a static import-boundary
  test, not by convention.
- A connector (and the edge agent) NEVER persists. Persistence happens in the CALLER
  (the api-server refresh service or the agent ingest route) via the shared
  persist helper. A connector only returns a DerivedSignalSet (numeric math).
- Anything declared but not implemented must surface the honest "available, not
  connected" error. Never return stub/empty data that could be mistaken for a real
  measurement.

## Why the runtime fs guard is a tripwire, not a sandbox
**Fact (proven empirically here):** ESM named/namespace imports of `node:fs` are
read-only bindings; assigning to them throws, so they CANNOT be monkey-patched. And
patching the CommonJS `require("node:fs")` object is NOT observed by code that did
`import ... from "node:fs"`. So a runtime patch can only catch require-based ambient
writes.
**Therefore:** the PRIMARY guarantee that extraction cannot touch the filesystem is
the static import-boundary test (connector + edge-agent source may not import
`node:fs` at all, which also catches `import("node:fs")` by string literal). The
runtime `guardedExtractSignals` wrapper is defense-in-depth only, and is documented
as such. Do not present it as a sandbox.
**How to apply:** when extending the guard or the boundary, keep the static scan as
the real control. The guard's patch window is process-global and reference-counted;
it could in principle trip a concurrent legitimate CJS fs write during a long
extraction, but no such live write path exists today.

## Agent trust model
- The per-tenant bearer credential is the API trust root (scrypt hash stored, row
  reloaded per request so a revoke is immediate). The server NEVER trusts a
  proxy-injected client-certificate header. Mutual TLS terminates at a proxy in
  production and protects the channel; the bearer authorizes the request.
- The edge-agent base URL is enforced HTTPS by default (loopback host or an explicit
  `EI_AGENT_INSECURE_HTTP=1` test opt-out aside) so the bearer is never sent in clear.
