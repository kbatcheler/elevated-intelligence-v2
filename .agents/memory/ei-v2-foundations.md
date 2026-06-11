---
name: EI V2 foundations gotchas
description: Non-obvious build-environment lessons from the EI V2 foundations (zod v4 uuid, esbuild workspace bundling).
---

# EI V2 foundations gotchas

## Zod v4 uuid validates RFC variant bits strictly
The contract layer imports `zod/v4` (the v4 API shipped under the subpath of
zod 3.25.76). `z.string().uuid()` in v4 rejects strings whose variant nibble is
not 8, 9, a, or b. A placeholder like `1111...-1111-...` fails validation even
though it looks well formed.
**Why:** a guard test for DerivedSignalSet failed on its own fixture, not the
schema, the first time.
**How to apply:** in any test fixture or seed needing a tenant id, use a real
v4 uuid (for example `gen_random_uuid()` output or `550e8400-e29b-41d4-a716-446655440000`),
never a repeated-digit placeholder.

## esbuild: bundle workspace packages, externalize third-party deps
The api-server build (`artifacts/api-server/build.mjs`) externalizes only its
`dependencies` that are not `@workspace/*`, and bundles everything else.
**Why:** workspace packages (for example `@workspace/db`) expose TypeScript
source through their exports map, not compiled JS. If externalized, the bundled
output would `import "@workspace/db"` and Node would try to run a `.ts` file at
runtime and fail. They must be compiled into the bundle.
**How to apply:** when a new artifact consumes a new `lib/*` workspace package,
keep that package out of the esbuild `external` list so its source is inlined;
keep real node_modules deps external so they load from node_modules.

## TS project references: rebuild libs before downstream typecheck
After editing an export in any `lib/*` package (db, cortex, etc.), run
`pnpm run typecheck:libs` (a `tsc --build`) before running api-server or portal
typecheck/build. Otherwise the consumer reports the new export as missing.
**Why:** the workspace wires packages through TS project references that resolve
each lib from its built `dist`, not its source, so fresh exports are invisible
until the lib is rebuilt. The failure looks like a code bug but is a stale-dist
build-order issue.
**How to apply:** when a downstream typecheck cannot find a symbol you just
added to a lib, rebuild libs first instead of doubting the new code.
