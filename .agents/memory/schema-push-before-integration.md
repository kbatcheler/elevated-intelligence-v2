---
name: Push a new Drizzle table to the dev DB before integration tests
description: A new table in lib/db/src/schema is not in the live dev Postgres until pushed; integration tests 500 on the missing relation while unit tests stay green.
---

# A new Drizzle table must be pushed to the dev DB before integration tests pass

Defining a table in `lib/db/src/schema/*.ts` only changes the code model. The live
development Postgres that the api-server INTEGRATION tests boot against is NOT migrated
automatically. Until the schema is applied, any query against the new relation fails at
runtime (a route returns 500, the integration test that hits it fails on the missing
relation), even though typecheck, build, and all PURE/unit tests stay green because they
never touch the database.

**Why:** integration tests run against real Postgres; unit tests do not. So a green
typecheck/build and green unit tests can coexist with a 500 that is purely "the table
does not exist yet". Seen when `finding_challenges` was added: the GET history
integration test 500'd until the table was created, then passed unchanged.

**How to apply:** after adding or altering a table, apply the schema to the dev DB
before (re)running the `test` workflow: `pnpm --filter @workspace/db push` (drizzle-kit
push). Then verify the columns exist if in doubt. This is a per-schema-change step, not a
one-time setup. The same applies to the production DB at deploy time (see the database
skill for prod schema sync); pushing dev does NOT touch prod.
