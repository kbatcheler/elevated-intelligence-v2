// Vitest globalSetup for the api-server suite. Runs ONCE in the main process
// before any worker is spawned and provisions the isolated test databases so the
// integration tests never touch the shared development Postgres the live dev
// server uses (which let leftover rows accumulate between runs and made parallel
// test files contend with the dev server's pool and with each other).
//
// Strategy (see testDb.ts for the layout and the why):
//   1. Ensure a pristine TEMPLATE database (<db>_test_tpl): create it if missing,
//      apply the current schema with drizzle-kit push (idempotent), and seed the
//      canonical layer registry (idempotent upsert) that several integration tests
//      treat as pre-existing reference data. The template is never written to by
//      tests, so it stays clean and the push/seed are fast no-ops on later runs.
//   2. Recreate one WORKER database per vitest pool slot (<db>_test_w<N>) from the
//      template with CREATE DATABASE ... TEMPLATE, a fast binary copy. Dropping and
//      recreating each run gives every worker a deterministic clean slate carrying
//      the schema and the seeded layers, regardless of what a previous (possibly
//      crashed) run left behind.
//
// The raw admin SQL (CREATE/DROP DATABASE, terminate) goes through the `psql`
// binary from the provisioned postgresql module rather than a `pg` client, because
// `pg` is a dependency of `@workspace/db`, not of this package, so it is not
// resolvable here under pnpm's strict module layout. Schema push and the layer seed
// run as the existing `@workspace/db` package scripts (which DO have pg/drizzle),
// with DATABASE_URL pointed at the template.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  devDatabaseUrl,
  maxWorkerCount,
  templateDatabaseName,
  templateDatabaseUrl,
  workerDatabaseName,
} from "./testDb";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function psql(url: string, args: string[]): string {
  return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
  });
}

function databaseExists(name: string): boolean {
  // Connect to the dev database to inspect the catalog (you cannot create or drop
  // a database while connected to it). The name is derived from our own
  // environment, never user input, and a database identifier cannot be parameterised.
  return (
    psql(devDatabaseUrl(), [
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
    ]).trim() === "1"
  );
}

function createDatabase(name: string): void {
  psql(devDatabaseUrl(), ["-c", `CREATE DATABASE "${name}"`]);
}

function dropDatabase(name: string): void {
  // Terminate any leftover sessions from a previous run, then drop.
  psql(devDatabaseUrl(), [
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  ]);
  psql(devDatabaseUrl(), ["-c", `DROP DATABASE IF EXISTS "${name}"`]);
}

function createFromTemplate(name: string, template: string): void {
  psql(devDatabaseUrl(), [
    "-c",
    `CREATE DATABASE "${name}" TEMPLATE "${template}"`,
  ]);
}

function runDbScript(script: string, databaseUrl: string): void {
  execFileSync("pnpm", ["--filter", "@workspace/db", "run", script], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

function ensureTemplate(): void {
  const name = templateDatabaseName();
  if (!databaseExists(name)) createDatabase(name);
  runDbScript("push-force", templateDatabaseUrl());
  runDbScript("seed:layers", templateDatabaseUrl());
}

export default async function setup(): Promise<void> {
  ensureTemplate();
  const template = templateDatabaseName();
  const count = maxWorkerCount();
  for (let id = 1; id <= count; id++) {
    const name = workerDatabaseName(id);
    dropDatabase(name);
    createFromTemplate(name, template);
  }
}
