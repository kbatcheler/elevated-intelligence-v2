import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Explicit pool sizing and timeouts so the API survives bursty concurrent
// traffic instead of opening unbounded connections or hanging on a stuck
// query. max caps how many server-side connections we hold (raise it for a
// bigger instance via DATABASE_POOL_MAX). The timeouts make failures fast and
// loud: a query that stalls past statement_timeout errors out and frees its
// connection rather than pinning a pool slot forever.
//
// Under the test runner each test FILE runs in its own forked process with its
// own pool, so a large per-process cap multiplies across parallel files and can
// exhaust the database's max_connections (manifesting as intermittent connect
// timeouts in whichever test happens to be running). Queries within a file run
// sequentially, so a small cap is ample; bound it low in tests while keeping the
// generous server default. An explicit DATABASE_POOL_MAX still wins in both.
function defaultPoolMax(): number {
  return intFromEnv("DATABASE_POOL_MAX", process.env.VITEST ? 5 : 20);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: defaultPoolMax(),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./contracts";
