// Connection details for the api-server integration suite's isolated databases.
//
// The suite runs against DEDICATED, disposable databases on the same provisioned
// Postgres server as the dev database, never the shared development database the
// live dev server uses. Isolation is PER VITEST WORKER, not just per run, because
// a provider/owner seat sees EVERY tenant in its database (resolveAccessibleTenantIds
// returns the whole tenants table), so a route like GET /api/push/notifications
// upserts a default rule across all of them. With every test file sharing one
// database that fan-out spans every concurrently-running suite's tenants and turns
// into lock contention; giving each worker its own database means a worker only
// ever sees the tenants of the files that ran in it (which execute sequentially
// within the worker and clean up after themselves), so the fan-out stays small and
// the suite is deterministic with file parallelism on.
//
// Layout (derived from DATABASE_URL, same server, swapped database name):
//   <db>_test_tpl    a pristine template: schema applied + canonical layers seeded,
//                    never written to by tests; the fast clone source.
//   <db>_test_w<N>   one database per worker, recreated from the template each run
//                    via CREATE DATABASE ... TEMPLATE (a fast binary copy).
//
// All derivations are pure and idempotent so globalSetup, the per-worker setup, and
// vitest.config agree on exactly the same names.
import os from "node:os";

const MAX_WORKERS_CAP = 8;

export function devDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL must be set to derive the isolated test database URLs",
    );
  }
  return base;
}

// Strip any suffix we may have appended so derivation stays idempotent even when
// DATABASE_URL has already been pointed at a worker or template database (the
// per-worker setup mutates it in-process, and forks inherit that value).
function originalBaseName(): string {
  const name = new URL(devDatabaseUrl()).pathname.replace(/^\//, "");
  if (!name) {
    throw new Error(
      "DATABASE_URL has no database name to derive a test database from",
    );
  }
  return name.replace(/_test(_tpl|_w\d+)?$/, "");
}

function withDatabaseName(name: string): string {
  const url = new URL(devDatabaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

function testBaseName(): string {
  const suffix = process.env.TEST_DATABASE_SUFFIX ?? "_test";
  return `${originalBaseName()}${suffix}`;
}

export function templateDatabaseName(): string {
  return `${testBaseName()}_tpl`;
}

export function templateDatabaseUrl(): string {
  return withDatabaseName(templateDatabaseName());
}

export function workerDatabaseName(workerId: number): string {
  return `${testBaseName()}_w${workerId}`;
}

export function workerDatabaseUrl(workerId: number): string {
  return withDatabaseName(workerDatabaseName(workerId));
}

// The vitest pool slot this process serves (1-based, stable for the worker's
// lifetime). Bounded by maxForks, so it indexes one of the worker databases.
export function currentWorkerId(): number {
  const raw = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function fileParallelismEnabled(): boolean {
  const raw = process.env.VITEST_FILE_PARALLELISM;
  if (raw) return raw === "1" || raw.toLowerCase() === "true";
  return true;
}

function configuredWorkerCount(): number {
  const raw = process.env.VITEST_MAX_FORKS;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const cpus = os.availableParallelism?.() ?? os.cpus().length;
  return Math.max(1, Math.min(cpus, MAX_WORKERS_CAP));
}

// How many worker databases to provision and the maxForks to cap the pool at.
// They must match: every pool id in use must map to a database that exists.
export function maxWorkerCount(): number {
  return fileParallelismEnabled() ? configuredWorkerCount() : 1;
}
