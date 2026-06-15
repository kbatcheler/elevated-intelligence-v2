---
name: V2 drift and build-report protocol
description: How each V2 addendum phase is gated, where the reports live, and the long-dash sweep every phase must pass.
---

# V2 drift and build-report protocol

The Autonomous Execution + Drift Control Protocol for the Elevated Intelligence V2
addendum. Follow this every phase so the docs stay consistent.

## Source of truth and resume
- `docs/drift/INDEX.md` is THE source of truth for build progress. On restart, read
  it, find the last phase that passed its gate, continue from the next. Do not
  restart from Phase A.
- `PAUSE_AT_MILESTONES = true`. Milestones are hard stops for owner review; the build
  must STOP after a milestone phase and not auto-advance. (The V2 addendum runs
  H, then I; I is a milestone before Tier 2.)

## Per-phase gate (in order)
1. Build the phase.
2. Verify: typecheck, build, acceptance checks, regression/parity contract, the
   long-dash sweep, full test suite.
3. Write the drift report `docs/drift/phase-<id>.md` (follow the prior phase file's
   structure: build summary, requirements checklist, drift items (category sweep then
   specifics), decisions taken, test/verification summary, remediation iterations,
   verdict, milestone marker).
4. Append a `## Phase <id>: ...` section to `docs/build-report-v2.md` (match the prior
   section's shape). The core report for Phases A-G is frozen at
   `docs/build-report-core.md`; never restate it.
5. Update `docs/drift/INDEX.md` (add the verdict table row + a verbose prose "Phase
   <id> gate met" note + bump the rollup reference "A through <id>").
6. Update `docs/drift/rollup.md` (retitle "A through <id>", bump "Last updated",
   add the verdict row, add decisions/drift items, add a "No faked output" paragraph).
7. Run the architect (code_review skill, `responsibility: evaluate_task`,
   `includeGitDiff: true`). Apply blocking fixes; apply cheap non-blocking hardening
   and record it (Phase H and I both did this). Record the architect verdict in the
   drift report's "Remediation iterations".

## Hard constraints (every phase)
- Zero new npm deps. Workspace packages + Node built-ins only; `pg`/`@types/pg` are
  already in the lockfile.
- No em-dash (U+2014) or en-dash (U+2013) ANYWHERE: source, copy, AND data. Docs must
  be ASCII-only.

## The long-dash sweep is two-sided
- Source: the scripts `emDashGuard` test scans lib/artifacts/docs/scripts text files.
- Data: sweep EVERY public table, per row, casting the row to text and matching
  U+2014/U+2013. A prior phase (G) found long dashes only in persisted model output
  (`tenant_pipeline_runs.sub_stages`) that the source guard cannot see; the fix was a
  deterministic sanitizer at every jsonb persist boundary. So a model-output persist
  path is the usual suspect when the DB sweep is non-zero.

## Audit/remediation pass after a milestone (NOT a phase)
An owner request to "audit/drift-report the system to date and action remediations"
that arrives AFTER a milestone hard stop is not a new phase. Do NOT mint a fake next
phase letter or advance any gate.
- Write a dedicated doc, e.g. `docs/drift/audit-post-<lastphase>.md` (method, posture,
  remediations actioned, accepted/deferred items with the operator action each needs,
  evidence, verdict).
- Move any now-resolved "Still live" item in `docs/drift/rollup.md` to "One-time or
  resolved" and add a short header note; do NOT append a "Phase <id>" section to
  `build-report-v2.md` (that is per-phase only).
- Add ONE prose note line to `docs/drift/INDEX.md` Notes (not a verdict-table row).
- Still run the gates, the two-sided dash sweep, and the architect evaluate_task.
**Why:** the milestone is a hard stop for owner review; a remediation pass must not look
like forward progress past it.

## Docs style
INDEX/rollup/phase notes are verbose prose; match that register, not terse bullets.
