import { defineConfig } from "vitest/config";
import { fileParallelismEnabled, maxWorkerCount } from "./src/test/testDb";

// The api-server suite is overwhelmingly INTEGRATION tests that boot a throwaway
// HTTP listener over a real Postgres. Each test FILE is forked into its own
// process, and each process opens its own `@workspace/db` pool.
//
// Those tests run against DEDICATED, disposable databases, not the shared
// development Postgres the live dev server uses. Isolation is PER WORKER, not just
// per run: `src/test/globalSetup.ts` builds a pristine template (schema + canonical
// layers) once and clones one database per vitest pool slot from it; the per-worker
// `src/test/setupEnv.ts` pins each worker's DATABASE_URL to its own clone before the
// db pool is constructed. A provider/owner seat sees every tenant in its database,
// so with one shared database parallel files still contended over each other's
// tenants (e.g. GET /api/push/notifications upserting across all of them); a database
// per worker keeps that fan-out scoped to the files that ran sequentially in that
// worker, so the suite is deterministic with file parallelism on.
//
// maxForks is capped to the number of provisioned worker databases so every pool id
// in use maps to a database that exists. Parallelism and timeouts stay
// env-overridable for a slower machine or a single-fork spot-check
// (VITEST_FILE_PARALLELISM, VITEST_MAX_FORKS, VITEST_TEST_TIMEOUT_MS). None of this
// changes product runtime behaviour; it only shapes the test runner.
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
    globalSetup: ["src/test/globalSetup.ts"],
    setupFiles: ["src/test/setupEnv.ts"],
    fileParallelism: fileParallelismEnabled(),
    testTimeout: timeoutMs(),
    hookTimeout: timeoutMs(),
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: maxWorkerCount(),
      },
    },
  },
});
