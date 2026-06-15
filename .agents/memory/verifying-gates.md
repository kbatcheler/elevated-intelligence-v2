---
name: Verifying gates and the two-sided dash sweep
description: How to run typecheck/build/test and the long-dash sweep reliably in this repo, given lossy workflow logs.
---

# Verifying gates reliably

**Workflow console logs are lossy for the gate workflows.** `pnpm run typecheck|build|test`
repaint the terminal with a TTY progress reporter, so the captured workflow log often keeps
only the final tail line and drops the per-package detail you need to confirm a green run.

**How to apply:** run a gate to a file and check the exit code instead of trusting the
workflow log, e.g. `pnpm run test > /tmp/test.out 2>&1; echo EXIT $?`, then read `/tmp/test.out`.
Do NOT invoke `vitest` directly in the shell for this repo; go through the `pnpm run` scripts.

# The two-sided long-dash sweep (em-dash U+2014 / en-dash U+2013)

The hard constraint forbids long dashes in BOTH source AND database data, so a phase is not
done until BOTH sides read zero:

- **Source side:** the `scripts` package test runs the source guard (`findLongDashViolations`
  over the repo root) and must return `[]`. For a fast manual confirmation, ripgrep the
  authored tree for the two codepoints; a clean tree exits non-zero (no match):
  `rg -n $'[\u2014\u2013]' lib artifacts docs scripts` (exclude the guard's own source, which
  legitimately contains the literals).
- **Database side:** sweep every public `text`/`jsonb` column by casting to text and matching
  the two codepoints, via the code_execution `executeSql` callback (read `.output`, CSV). New
  tables added by a phase widen this set, so re-run after any schema or data change.

**Why:** authored drift/build-report Markdown is part of the source tree the guard scans, so
writing those docs can itself introduce a violation; always re-sweep the source side AFTER
writing the phase docs, not only after the code.
