---
name: Portal testing under the zero-new-dependency rule
description: How to add meaningful portal (artifacts/portal) tests when jsdom and testing-library are not installed and cannot be added.
---

# Portal testing without DOM dependencies

The portal must have tests, but the project forbids new npm dependencies, and
jsdom / happy-dom / @testing-library/* are NOT installed. vitest and
@vitejs/plugin-react ARE available (catalog devDeps). So component DOM-rendering
tests are off the table without breaking the zero-dep rule.

**The pattern that works:** extract the real logic out of the React components into
framework-free `lib/*Api.ts` modules and unit-test those with a mocked
`globalThis.fetch` in vitest's default node environment. The "real logic" in the
portal is the data layer: which route is called, request method/body, the
HTTP-status-to-error-code mapping, 401 detection, and list-state derivation
(ready / empty / error). The components then become thin: call the module, and on
a 401 result call logout themselves.

Existing modules built this way: `authApi.ts` (login, register, status, logout)
and `adminApi.ts` (the Access console: org/pin/user/tenant loaders plus mintPin,
revokePin, setUserStatus, createOrg, bindTenant). A 401 surfaces as
`{ unauthorized: true }` so the pure function never imports React or calls logout.

**Why:** keeps tests meaningful (they exercise production code, not mocks of
mocks) while honouring the zero-dep non-negotiable. DOM component tests stay
deferred and are documented as such in `docs/deploy-readiness.md` and
`docs/drift/rollup.md`.

**How to apply / gotchas:**
- The portal `tsconfig.json` EXCLUDES `**/*.test.ts(x)`, so test files are never
  typechecked by `tsc --noEmit`; rely on vitest at runtime. Import vitest helpers
  explicitly (`import { describe, it, expect, vi } from "vitest"`) so no global
  types are needed.
- `vite.config.ts` has no `test` field, so vitest runs in the node env (no DOM).
- The portal `test` script is `vitest run` (no `--passWithNoTests`), so an empty
  or deleted suite now fails loudly. Do not re-add `--passWithNoTests`.
- When a `.then(...)` callback mixes `return someFn()` (a value) with fall-through
  paths, `noImplicitReturns` throws TS7030. Use `fn(); return;` instead.
