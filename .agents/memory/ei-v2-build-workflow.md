---
name: EI-V2 build & drift workflow
description: How to run checks, the per-phase two-sided dash sweep, and the drift docs that must be updated every phase in the Elevated Intelligence V2 monorepo.
---

# Running checks

- Run typecheck/build/test through the configured WORKFLOWS, not ad-hoc shell. Restart the
  `typecheck`, `build`, or `test` workflow, then `refresh_all_logs` and read the newest
  `/tmp/logs/<workflow>_*.log` (check the timestamp to confirm it is the latest run).
- NEVER run `vitest` (or `pnpm test`) directly in the shell. It gets KILLED by the sandbox.
  A single-package typecheck via `pnpm --filter <pkg> run typecheck` is fine and fast.

# Two-sided dash sweep (a per-phase gate; must read zero on BOTH sides)

The hard constraint is ASCII hyphen only, never em-dash (U+2014) or en-dash (U+2013), in source
AND in database data.

- Source side: ripgrep for the two codepoints over lib, artifacts, docs, scripts, replit.md,
  .replit, .github. The `scripts/src/emDashGuard.ts` guard also runs as part of the test suite
  (the "scripts" package tests), but the suite only covers files that existed when it ran, so
  re-grep any docs you added after the last test run.
- Database side: use `code_execution` -> `executeSql`. It returns `{ success, output, ... }`
  where `output` is psql TEXT (parse the text, there is no `.rows`). Enumerate every public
  `text`/`character varying`/`character`/`jsonb`/`json` column from `information_schema.columns`,
  then build one dynamic `UNION ALL` counting rows matching `~ '[<U+2014><U+2013>]'` (cast jsonb
  with `::text`). The gate line is `TOTAL DASH HITS 0` (the column count is whatever the schema
  currently has; do not hardcode it).

# Per-phase drift protocol (docs/drift/INDEX.md is the source of truth)

Every phase updates ALL of these, advancing the "A through <id>" marker:

1. `docs/drift/phase-<id>.md` - new file, mirror the previous phase's structure (intro +
   adaptation note, what built, honesty constraint, acceptance checklist, verification, logged
   drift, gate).
2. `docs/build-report-v2.md` - append a `## Phase <id>` section with `###` subsections.
3. `docs/drift/INDEX.md` - add a verdict-table row AND a long Notes paragraph; bump the
   "Cross-phase drift rollup (A through <id>)" line.
4. `docs/drift/rollup.md` - bump the title and the "Last updated after Phase <id>" paragraph,
   add a verdicts-table row, add any "Still live" entries, and add a "No faked output" paragraph
   for the phase at the TOP of that section.

# No manual git

Replit auto-checkpoints; there is no manual `git commit`/tag step. INDEX.md is the protocol's
progress source of truth in place of per-phase git tags (logged as accepted drift).

# Per-phase loop

architect `plan` up front -> build -> verify (typecheck/build/test + two-sided dash sweep) ->
architect `evaluate_task` to PASS (fix severe findings, log accepted LOWs as drift) -> drift
docs. `PAUSE_AT_MILESTONES=true`; milestones are C, G, H, I, K, T, X, AI, AJ.
