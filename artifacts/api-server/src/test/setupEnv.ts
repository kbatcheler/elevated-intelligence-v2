// Per-worker vitest setup (setupFiles). Runs in EACH worker process before any
// test module is imported, so it pins DATABASE_URL to this worker's own isolated
// database BEFORE `@workspace/db` is first imported and builds its connection pool.
// Each vitest pool slot gets a dedicated database (see globalSetup.ts and testDb.ts),
// keeping parallel test files off the shared dev Postgres and out of each other's way.
import { currentWorkerId, workerDatabaseUrl } from "./testDb";

process.env.DATABASE_URL = workerDatabaseUrl(currentWorkerId());
