---
name: Stage 6 build (Calibration/Efficacy/Decision Intelligence, phases AJ-AN)
description: How to run the disciplined per-phase greenfield loop for this repo - resume source, drift-doc set, verification path, and tool-output gotchas.
---

# Running the autonomous phased build (Elevated Intelligence V2)

The build advances phase by phase under `build-prompts/EI-V2-Autonomous-Execution-and-Drift-Control-Protocol.md`.
Stage 6 (the final stage) is phases AJ to AN, spec'd in
`build-prompts/EI-Calibration-Efficacy-and-Decision-Intelligence-Addendum.md`. AJ (Brier
calibration ledger) is done; AK efficacy index, AL decision ledger + pre-mortem, AM as-of
replay + diligence pack, AN final verification. AK is read-time, AL needs schema.

## Resume source of truth
`docs/drift/INDEX.md` is the canonical progress record. On any restart, read it, find the last
phase that passed its gate, continue from the next. Never restart from Phase A, never re-run a
passed phase.

## Drift doc set updated in LOCKSTEP every phase (4 writes)
- `docs/drift/phase-<id>.md` (new; mirror `phase-AJ.md` / `phase-AG.md` structure exactly).
- append a section to `docs/build-report-v2.md`.
- `docs/drift/INDEX.md`: add the phase's table row + a Notes bullet (+ milestone marker only if it is one).
- `docs/drift/rollup.md`: bump the "A through <id>" title/intro, add a verdicts row, refresh still-live items.

## Gotchas that cost real time
- **The source dash guard scans `docs/` too**, not just lib/artifacts/scripts. After writing ANY
  drift markdown you MUST re-run the guard (and the DB-wide sweep); both must read zero. ASCII
  hyphen only, never U+2014/U+2013, in source AND db data AND all markdown.
- **Run the full suite via the `test` workflow** (restart_workflow, timeout ~240s) then
  `refresh_all_logs`; a direct `pnpm run test` in bash exceeds the 120s bash cap. Per-package
  `pnpm --filter <pkg> test` does fit under 120s for targeted runs.
- **bash/grep command OUTPUT is display-mangled** in this environment (drops/garbles letter runs,
  e.g. shows "ln" for "AK", "nl" for "all"). Trust the `read` tool for accurate file content, never
  grep output, when correctness matters.
- **architect (code_review skill)**: `await architect({task, relevantFiles, responsibility, includeGitDiff})`
  via code_execution. The verdict/summary is in `result.message`; `result.result` is a long file dump.
  Use responsibility "plan" up front, "evaluate_task" at the gate, "debug" when stuck.
- Hard constraints: ZERO new npm deps (workspace + Node builtins only; external services over HTTP
  as available-not-connected adapters, never SDKs); never fabricate telemetry/output (compute from
  persisted state or show a dash, never a fabricated zero); no literal model ids (SEATS only); cortex
  seats/telemetry must be REAL; NEVER git commit (the platform checkpoints).
- Efficacy/health style figures follow the repo's "derived at read time, never stored so it cannot
  drift" pattern (see connector connectionHealth) rather than a persisted column.
