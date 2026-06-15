---
name: Stage gate workflow quirks
description: Non-obvious operational facts for running the Drift Control Protocol gates (typecheck/build/test workflows) in this repo.
---

# Running the gate workflows

- **Log flush ordering.** `restart_workflow` returns once a workflow has STARTED, not finished. For
  one-shot workflows (typecheck/build/test) you must `sleep` ~75-90s, THEN call `refresh_all_logs`
  to flush the new `/tmp/logs/<wf>_<ts>.log` files. A bare `ls -t /tmp/logs/...` BEFORE a refresh
  returns the previous run's stale file and will mislead you into reading an old verdict.
  **Why:** the log files are only materialized on refresh, not on workflow start/finish.

- **Long-dash guard scope.** The em/en-dash source guard (the `test` workflow's "long-dash guard")
  scans only the authored source roots (lib, artifacts, docs, scripts) and the DB columns. It does
  NOT scan `infra/` (Terraform) or a root `Dockerfile`. After editing those, verify ASCII manually
  with `rg -nP "[\x{2014}\x{2013}]"` before declaring a phase green.
  **Why:** those paths are outside the guard's configured roots, so a stray em/en-dash there passes CI silently.

- **Known flaky integration test.** `artifacts/api-server/src/routes/push.integration.test.ts`
  ("marks one event read, then read-all clears the badge") can intermittently get a 500 instead of
  200 on `GET /api/push/notifications` under the concurrent api-server vitest run. This is a transient
  Postgres pool-timeout, not a real regression. If it fails alone while everything else is green,
  re-run the `test` workflow once to confirm green.
  **How to apply:** only treat it as real if it reproduces across re-runs or alongside other failures;
  a single isolated 500 here is a flake, not a regression.

- **DB-wide long-dash sweep (the data side of the gate).** The source `emDashGuard` does NOT cover
  database content, so a stage-close must ALSO run a fresh DB-wide cast for em-dash (chr(8212)) and
  en-dash (chr(8211)) over every public text/jsonb/varchar/char column. Do it via the `executeSql`
  callback in code_execution, but note its return shape is `{success, output, exitCode, exitReason}`
  where `output` is the raw psql TEXT block (header line, data rows, trailing "(N rows)"), NOT
  structured rows. Parse the text. Practical approach: query `information_schema.columns` joined to
  `information_schema.tables` (table_type='BASE TABLE') for the column list, then build one
  `UNION ALL` of `SELECT count(*) FROM "t" WHERE "c"::text LIKE '%'||chr(8212)||'%' OR ... chr(8211) ...`
  and sum it. At end of Stage 5 this covered 144 text/jsonb columns across the 39 base tables (the
  columns live in 37 of them).
  **Why:** a naive `cols.rows`/`cols.output.rows` access returns nothing and silently reports 0 tables,
  which looks like a clean sweep but actually scanned nothing.
