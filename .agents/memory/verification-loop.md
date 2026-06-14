---
name: Verification loop on this repo
description: How to actually run and read the checks here without getting processes killed or chasing missing owner secrets.
---

# Verification loop

Run the checks through the configured workflows, not ad-hoc shell commands, then read the
flushed log files.

- Do NOT run `vitest`/`pnpm test` directly in the agent shell: a direct vitest run gets KILLED
  partway (sandbox resource limits). Instead `restart_workflow` the `test` workflow, wait for
  it to finish, then read the latest `/tmp/logs/test_*.log`. Same pattern for `typecheck` and
  `build`. The full suite is the regression gate.
- **Why:** the shell kill looks like a test failure but is not; it cost real time before this
  was understood. The workflow runner is the supported path and survives the full run.
- To get the per-package test breakdown for a drift doc, grep the test log for
  `Tests +[0-9]+ passed`. The grep/rg result DISPLAY occasionally mangles identifiers
  cosmetically (e.g. `client-viewer` shown truncated); the files on disk are correct, so trust
  the file, not the rendered snippet.

## Owner secrets are workflow-only

`OWNER_EMAIL`, `OWNER_PASSWORD`, `SESSION_SECRET` are injected into the workflow processes only,
not the agent shell or the code-execution sandbox. So live owner behaviour is verified through
the integration suite and the bootstrapped owner row, never an interactive login or curl from
the shell. Do not try to read these values; design the check to run inside the suite.

## Two-sided dash sweep

A phase is not dash-clean until BOTH sides read zero: the source guard
(`rg -nP "[\x{2013}\x{2014}]"` over lib, artifacts, docs, scripts, replit.md, .replit, .github)
AND a database-wide cast over every text and jsonb column in every public table. The DB sweep
catches dashes that the source guard cannot see because they live in persisted model output
(this has bitten before: a pipeline run table persisted raw model text with em-dashes).
