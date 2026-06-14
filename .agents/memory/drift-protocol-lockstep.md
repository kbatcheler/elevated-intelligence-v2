---
name: Drift protocol lockstep
description: The exact set of docs that must move together each phase, and the internal structure of rollup.md, so the source-of-truth stays consistent.
---

# Drift protocol lockstep

`docs/drift/INDEX.md` is the stated source of truth for build progress (it stands in for
per-phase git tags, which this Replit managed-VCS environment does not use). Each completed
phase must move FIVE things in lockstep to the new last phase, or the source of truth silently
disagrees with itself:

1. Create `docs/drift/phase-<id>.md` (full per-phase report).
2. Append a `## Phase <id>: ...` section to `docs/build-report-v2.md`.
3. `docs/drift/INDEX.md`: add a verdicts-table row, add a `## Notes` bullet, and update the
   final "Cross-phase drift rollup (A through <prev>)" line to the new last phase.
4. `docs/drift/rollup.md`: see its five internal spots below.
5. Update `.agents/memory/` if a durable lesson emerged.

**Why:** the protocol is the only progress record; a half-updated set makes a future agent
distrust the whole trail.

## rollup.md has five internal spots per phase

When updating `docs/drift/rollup.md`, all of these move:

1. The H1 title `# Drift rollup: Phases A through <last>`.
2. The "Last updated after Phase <last> (...)" summary paragraph near the top (replace, do not
   append; it describes only the newest phase).
3. The "## Phase verdicts" table (add the row).
4. The "## No faked output, any phase" section: PREPEND a new "Phase <id> added no faked
   output..." paragraph above the previous one, ending with "Phase <prev> below holds, and the
   earlier phases under it." (the section is newest-first, chained down to A-through-G).
5. The "## Logged spec deviations (decisions)" section: append any new decision bullets tagged
   with the phase letter, e.g. "(T)".

**How to apply:** read the current INDEX/rollup tails first to copy exact anchors; the table
column order is `Phase | Name | Verdict | Milestone`.
