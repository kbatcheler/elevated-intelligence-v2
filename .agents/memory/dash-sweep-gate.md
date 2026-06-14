---
name: DB long-dash sweep gate
description: The recurring per-phase gate step that proves zero em-dash/en-dash in the database, and why the source guard alone is not enough.
---

This project forbids the em-dash (U+2014) and en-dash (U+2013) everywhere: ASCII
hyphen only. Two enforcement surfaces, both part of every phase gate.

## Source: the emDashGuard

`scripts/src/emDashGuard.ts` scans authored dirs `lib`, `artifacts`, `docs`,
`scripts` over text extensions (includes `.md`), excluding vendored/generated dirs.
It runs inside the `scripts` test suite (the `test` workflow). So new docs under
`docs/` ARE covered by the guard once the suite runs.

## Data: the per-table DB sweep

The source guard cannot see model-generated text persisted to Postgres. So the gate
also sweeps every public table. Method that works (run via `executeSql` in
code_execution):

1. Build the dash class from escapes so the sweep code never contains the literal
   bytes: `const dashClass = "[" + "\u2014" + "\u2013" + "]";`
2. List tables: `SELECT tablename FROM pg_tables WHERE schemaname='public'`.
3. Build one `UNION ALL` of `SELECT '<t>' tbl, count(*) FROM public."<t>" x WHERE
   x::text ~ '<dashClass>'` per table (cast the whole row to text so every column,
   including jsonb, is checked).
4. Expect 0 hits on all tables (currently 22).

**Why a row-cast sweep:** a past phase found long dashes only in a jsonb column
(persisted raw model output) while every other table was clean; casting the whole
row to text catches dashes buried anywhere in jsonb.

**How to apply:** the sanitizer already runs at the jsonb persist boundaries, so a
code-only or docs-only phase will sweep clean without DB writes, but the gate still
expects this sweep to be run and reported as 0.
