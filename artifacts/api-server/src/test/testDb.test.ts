// A guard against the regression this isolation work fixed: the integration suite
// must NEVER run against the shared development database. The wiring lives across
// three files (testDb.ts derives the names, setupEnv.ts pins DATABASE_URL per
// worker before @workspace/db loads, vitest.config.ts wires setupEnv in as a
// setupFile). If any of that is removed or misconfigured the suite would silently
// fall back to the bare dev database, still pass, and corrupt real dev data. These
// assertions fail loudly instead.
import { afterEach, describe, expect, it } from "vitest";
import {
  currentWorkerId,
  workerDatabaseName,
  workerDatabaseUrl,
} from "./testDb";

function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

describe("isolated test database wiring", () => {
  const savedUrl = process.env.DATABASE_URL;
  const savedSuffix = process.env.TEST_DATABASE_SUFFIX;

  afterEach(() => {
    // Restore the worker-pinned environment after any case that mutates it, so the
    // live-run assertion below sees exactly what setupEnv.ts pinned.
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
    if (savedSuffix === undefined) delete process.env.TEST_DATABASE_SUFFIX;
    else process.env.TEST_DATABASE_SUFFIX = savedSuffix;
  });

  it("pins the running worker's DATABASE_URL to its own isolated test database", () => {
    const live = process.env.DATABASE_URL;
    expect(live, "DATABASE_URL must be set during the test run").toBeTruthy();

    const id = currentWorkerId();
    const name = databaseNameOf(live!);

    // The defining proof: setupEnv.ts pinned this to the derived worker URL. If the
    // setupFile wiring (setupEnv.ts / vitest.config.ts) is gone, the live URL is the
    // bare dev database and this fails.
    expect(live).toBe(workerDatabaseUrl(id));
    expect(name).toBe(workerDatabaseName(id));
    // It carries the per-worker test suffix; a bare dev name never ends in _w<N>.
    // Compare against the configured suffix so a custom TEST_DATABASE_SUFFIX run
    // (e.g. _ci) is still accepted as isolated rather than a false failure.
    const suffix = process.env.TEST_DATABASE_SUFFIX ?? "_test";
    expect(name).toMatch(/_w\d+$/);
    expect(name).toContain(suffix);
  });

  it("derives a suffixed worker name from a bare dev URL, never the bare name", () => {
    delete process.env.TEST_DATABASE_SUFFIX;
    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/appdb";

    for (const id of [1, 2, 8]) {
      const name = workerDatabaseName(id);
      const url = workerDatabaseUrl(id);
      expect(name).toBe(`appdb_test_w${id}`);
      expect(name).not.toBe("appdb");
      expect(databaseNameOf(url)).toBe(`appdb_test_w${id}`);
      expect(databaseNameOf(url)).not.toBe("appdb");
    }
  });

  it("honours a custom TEST_DATABASE_SUFFIX while keeping the _w<N> isolation", () => {
    process.env.TEST_DATABASE_SUFFIX = "_ci";
    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/appdb";

    const name = workerDatabaseName(3);
    expect(name).toBe("appdb_ci_w3");
    expect(name).not.toBe("appdb");
    expect(name).toMatch(/_w\d+$/);
  });

  it("stays idempotent when DATABASE_URL already points at a test database", () => {
    delete process.env.TEST_DATABASE_SUFFIX;
    // setupEnv mutates DATABASE_URL in-process and forks inherit it, so derivation
    // must strip any prior suffix rather than stack a second one.
    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/appdb_test_w2";
    expect(workerDatabaseName(1)).toBe("appdb_test_w1");

    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/appdb_test_tpl";
    expect(workerDatabaseName(5)).toBe("appdb_test_w5");
  });
});
