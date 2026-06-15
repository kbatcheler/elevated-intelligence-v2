---
name: DB-wide long-dash sweep
description: How to run the database half of the two-sided ASCII-hyphen gate, and the executeSql quirk that makes a DO block useless for it.
---

This repo's hard constraint is ASCII hyphen only in source AND in database data. The gate is
two-sided: the source guard (`scripts/emDashGuard.test.ts`, in the `test` workflow) covers authored
files, and a database-wide sweep must independently read zero before any phase is done. Em-dash is
`chr(8212)` (U+2014), en-dash is `chr(8211)` (U+2013).

**The quirk:** the code_execution `executeSql` callback returns `{success, output, exitCode}` where
`output` is the result-set rendered as CSV-ish text. It does NOT capture `RAISE NOTICE` output. A
`DO $$ ... RAISE NOTICE 'total %', n; END $$;` block runs fine but returns only `"DO\n"`, so you
never see the count. Do not use a DO block to report a sweep total.

**How to apply (the working pattern):**
1. Pull the column list with a plain query (parse `output` as CSV; first line is the header):
   `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND
   data_type IN ('text','character varying','jsonb','json','character') ORDER BY table_name,
   column_name;`
2. In JS, build ONE summing query of per-column subqueries and run it so the total comes back as an
   actual result set:
   `SELECT ( (SELECT count(*) FROM public."t" WHERE "c"::text LIKE '%'||chr(8212)||'%' OR "c"::text
   LIKE '%'||chr(8211)||'%') + ... ) AS total_long_dash_hits;`
   Casting `::text` lets the same predicate cover jsonb and varchar/char alongside text.
3. Expect `0`. As of mid-2026 the public schema has 138 such columns across 37 tables; that count
   grows only when a phase adds schema.

**Why:** the sanitizer runs at the jsonb persist boundary (model output can smuggle long dashes into
the DB where the source-only guard cannot see them), so the DB sweep is a real, separate check, not a
restatement of the source guard. A presentation-only or docs-only phase changes no DB data, so the
sweep stays 0, but re-running it fresh is the honest way to claim "zero on both sides" in the drift
record.
