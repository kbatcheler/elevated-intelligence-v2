# Memory index

- [Connector derive-and-discard and the fs guard](connector-fs-guard.md) — ESM node:fs bindings are unpatchable; static import-boundary is the real control, runtime guard is a tripwire; persist in the caller only.
- [V2 drift and build-report protocol](v2-drift-protocol.md) — how phases are gated, where reports go, and the source+DB long-dash sweep that every phase must pass.
- [Node gotchas hit in this repo](node-gotchas.md) — zod v4 .uuid() needs a real v4 UUID in tests; WHATWG URL hostname returns bracketed [::1] for IPv6 loopback.
