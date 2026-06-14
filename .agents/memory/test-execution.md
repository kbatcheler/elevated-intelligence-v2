---
name: Running tests and checks
description: How to run typecheck/build/test in this repo without the run getting killed
---

Running vitest (or tsc/build) directly in the agent shell gets the process KILLED before it
finishes.

**Why:** the agent shell terminates these long/heavy runs; the configured workflows have the
right environment (including workflow-injected secrets like SESSION_SECRET, OWNER_PASSWORD)
and resource handling.

**How to apply:** run via the configured workflows instead. Use `restart_workflow("test")`
(or `"typecheck"` / `"build"`), then `refresh_all_logs`, then read the flushed log file at
`/tmp/logs/<workflow>_<timestamp>.log`. Logs flush late, so refresh AFTER the run, and add a
short sleep before refreshing for the test suite. Owner secrets are injected into workflow
processes only (not the agent shell), so live auth behaviour must be verified through the
integration suite, not an interactive shell command.
