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

- **api-server test contention (was the flaky push 500 / mass 5000ms timeouts).** See
  [api-server test DB contention](api-server-test-contention.md). The api-server suite now runs
  files SEQUENTIALLY (`fileParallelism: false` in `artifacts/api-server/vitest.config.ts`) because
  parallel forks against the ONE shared dev Postgres contend and flake non-deterministically. Do not
  re-enable parallelism to "speed it up" without re-isolating the DB; single-fork is not slower here.

- **DB-wide long-dash sweep (the data side of the gate).** The source `emDashGuard` does NOT cover
  database content, so a stage-close must ALSO run a fresh DB-wide cast for em-dash (chr(8212)) and
  en-dash (chr(8211)) over every public text/jsonb/varchar/char column. Do it via the `executeSql`
  callback in code_execution. Its return shape is `{success, output, exitCode, exitReason}` where
  `output` is a **CSV string** (a header row like `table_name,column_name`, then comma-separated data
  rows, NO pipe delimiters and NO trailing "(N rows)" line). Split on newlines and on commas; skip the
  header. Do NOT try a plpgsql DO-block (it raises a syntax error through this callback). Practical
  approach: query `information_schema.columns` joined to `information_schema.tables`
  (table_type='BASE TABLE') for the column list, parse the CSV in JS, then build one
  `UNION ALL` of `SELECT count(*) FROM "t" WHERE "c"::text LIKE '%'||chr(8212)||'%' OR ... chr(8211) ...`
  and sum it. Column/table counts grow as the schema grows (Stage 5 ~144 cols / 39 tables; the AQ phase
  saw 185 cols / 44 tables); the count is not the point, a zero sum is.
  **Why:** assuming a pipe-delimited psql table (or `cols.rows`) returns nothing and silently reports 0
  columns / 0 tables, which looks like a clean sweep but actually scanned nothing.

- **Editing source DURING a test run flakes the whole api-server suite.** The `API Server` workflow runs
  under tsx watch. Any edit to api-server source while the `test` workflow is running triggers a watch
  reload that re-runs the bootstrap and the scheduled loops (retention, backups, notifier, connector
  maintenance), bursting Postgres connections past the pool ceiling and flaking dozens of integration
  tests on 5000ms timeouts at once. This is NOT a regression. After finishing all edits, re-run the
  `test` workflow CLEAN (no concurrent editing) and it goes green.
  **How to apply:** never judge a test verdict from a run that overlapped your edits; a mass-timeout
  burst that vanishes on a quiescent re-run is contention, not broken code.
