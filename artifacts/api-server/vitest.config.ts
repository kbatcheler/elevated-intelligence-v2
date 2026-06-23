import { defineConfig } from "vitest/config";

// The api-server suite is overwhelmingly INTEGRATION tests that boot a throwaway
// HTTP listener over the SHARED development Postgres. Vitest forks each test FILE
// into its own process, and each process opens its own `@workspace/db` pool. The
// default fork count tracks the CPU count (8 here), so a default run fans out ~8
// forks that all hammer the one database at once - AND it commonly overlaps the
// live `API Server` dev workflow, which holds its own pool connections.
//
// Under that contention two failure modes appear non-deterministically, ~6
// different tests each run, which is exactly the flakiness this config fixes:
//   1. A test times out at vitest's 5000ms default `testTimeout` because an
//      otherwise-healthy query is starved of CPU/IO.
//   2. A route returns 500 because a query inside the request handler times out
//      acquiring a pool connection under the load. The provider-seat
//      `GET /api/push/notifications` is the canonical victim: it upserts a
//      default push rule across EVERY accessible tenant in one statement, and the
//      shared dev DB accumulates tenants from every other suite, so that single
//      write is the most contention-sensitive query in the suite.
//
// Fix: run the api-server files SEQUENTIALLY in one worker
// (`fileParallelism: false`) so the integration files can no longer contend with
// each other for the shared database. With only one suite touching the DB at a
// time, the per-request queries complete well within their bounds, and the only
// remaining overlap is the idle dev server (tolerated by the larger under-test
// connection timeout in `@workspace/db`). The timeouts are also raised so a
// slow-but-working query never trips the 5000ms wall; a genuinely hung test
// still fails, just after a longer, contention-tolerant bound.
//
// Runtime stays reasonable: the files run back to back in a single warm process
// instead of paying per-fork startup, and unit-only files are tiny. Both knobs
// are env-overridable for a different machine or a quick parallel spot-check.
// None of this changes product runtime behaviour; it only shapes the test runner.
function fileParallelism(): boolean {
  const raw = process.env.VITEST_FILE_PARALLELISM;
  if (raw) return raw === "1" || raw.toLowerCase() === "true";
  return false;
}

function timeoutMs(): number {
  const raw = process.env.VITEST_TEST_TIMEOUT_MS;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 30_000;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: fileParallelism(),
    testTimeout: timeoutMs(),
    hookTimeout: timeoutMs(),
    pool: "forks",
  },
});
