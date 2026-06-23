---
name: api-server test DB isolation
description: How the api-server vitest suite is isolated per worker so file parallelism is deterministic, and the contention failure modes that drove it.
---

# api-server integration suite uses a database PER VITEST WORKER

The api-server suite is overwhelmingly INTEGRATION tests that boot a throwaway HTTP listener
over a real Postgres. Vitest forks each test FILE into its own process, each opening its own
`@workspace/db` pool. Running every file against ONE shared database is non-deterministic in
two shapes:

1. A query times out because a healthy statement is starved of CPU/IO under the fan-out.
2. A route returns 500 because a query inside the handler times out under load. The canonical
   victim is the provider-seat `GET /api/push/notifications`: it upserts a default push rule
   across EVERY accessible tenant in one statement, and for a provider/owner
   `resolveAccessibleTenantIds` returns the WHOLE tenants table. So with one shared DB that
   single write fans out across every concurrently-running suite's tenants and deadlocks /
   lock-waits. (The row count is trivial; only the contention is the problem.)

A single shared TEST database (separate from the dev DB) removes cross-RUN accumulation but
NOT within-run parallel coexistence: while push.integration runs, the other ~79 files are
concurrently creating tenants that the provider seat still sees. That alone stayed flaky.

## The decision: clone a template database per worker

Isolation is per vitest worker, not just per run. A pristine TEMPLATE database
(`<db>_test_tpl`) gets the schema applied + canonical layers seeded ONCE; then one database
per pool slot (`<db>_test_w<N>`) is recreated each run from it with
`CREATE DATABASE ... TEMPLATE` (a fast binary copy, ~0.6s, that carries the seeded layers).
`maxForks` is capped to the number of provisioned worker DBs so every `VITEST_POOL_ID` in use
maps to a database that exists. Each worker runs its files SEQUENTIALLY in its own DB, so the
provider fan-out only ever sees that worker's own tenants. File parallelism is on by default
and deterministically green on repeat runs.

**Why a database per worker and not per file:** per-file would mean ~80 schema builds; the
template-clone bounds it to the worker count (~8) and the clone is a cheap binary copy.

**Why `psql` for the admin SQL:** `pg` is a dependency of `@workspace/db`, not of api-server,
so it is not resolvable from the test setup under pnpm's strict layout. CREATE/DROP DATABASE
and the connection-terminate go through the `psql` binary (postgresql module); schema push and
the layer seed reuse the `@workspace/db` package scripts (which DO have pg/drizzle) with
`DATABASE_URL` pointed at the template.

**How to apply:** the knobs are env-overridable (`VITEST_FILE_PARALLELISM`, `VITEST_MAX_FORKS`,
`VITEST_TEST_TIMEOUT_MS`, `TEST_DATABASE_SUFFIX`). Derivations in `testDb.ts` strip any existing
`_test(_tpl|_w\d+)` suffix so they stay idempotent even though the per-worker setup mutates
`DATABASE_URL` in-process. Do not point the suite back at the shared dev DB to "simplify" it;
the provider-global tenant fan-out is the reason isolation is required.
