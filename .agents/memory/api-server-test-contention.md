---
name: api-server test DB contention
description: Why the api-server vitest suite runs files sequentially, and the two contention failure modes it cures.
---

# api-server integration suite runs single-fork on purpose

The api-server suite is overwhelmingly INTEGRATION tests that boot a throwaway HTTP listener
over the ONE shared development Postgres. Vitest forks each test FILE into its own process,
each opening its own `@workspace/db` pool. The default fork count tracks the CPU count, so a
default run fans out ~8 forks hammering the single DB at once, often overlapping the live
`API Server` dev workflow (which holds its own pool connections). The result was
non-deterministic flakes, a different ~6 tests each run, in two shapes:

1. A test times out at vitest's 5000ms default `testTimeout` because a healthy query is
   starved of CPU/IO.
2. A route returns 500 because a query inside the handler times out under the load. The
   canonical victim is the provider-seat `GET /api/push/notifications`: it upserts a default
   push rule across EVERY accessible tenant in one statement, and the shared dev DB
   accumulates tenants from every other suite, so that single write is the most
   contention-sensitive query in the suite. (The size is trivial; only the contention is the
   problem.)

## The decision

The api-server suite runs files sequentially (`fileParallelism: false`) against the shared
dev DB, with raised test timeouts as a contention safety net and a more generous pool
acquire timeout under `VITEST` so the idle dev-server overlap waits rather than 500s. The
knobs are env-overridable (`VITEST_FILE_PARALLELISM`, `VITEST_TEST_TIMEOUT_MS`,
`DATABASE_POOL_CONNECT_TIMEOUT_MS`); product (non-test) pool defaults are unchanged.

**Why this is the right tradeoff:** with a single shared DB, parallel forks cannot be made
deterministic without isolating the data, and single-fork is not meaningfully slower here
because removing per-fork startup roughly offsets the lost parallelism.

**How to apply:** do not re-enable file parallelism to "speed up" the suite without first
isolating the test DB from the dev server's pool (a separate test database). The shared-DB
assumption is the whole reason single-fork is required.
