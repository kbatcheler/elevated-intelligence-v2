# AUTONOMOUS EXECUTION AND DRIFT CONTROL PROTOCOL
## Different Day · Elevated Intelligence · The Run-To-Completion Wrapper

This document governs how the build prompts are executed. Read it first, before any of them. It applies to every phase of the greenfield build: the Greenfield Core Master Prompt (Phases A to G), then the downstream prompts exactly as re-sequenced and adapted by the Greenfield Build Plan and Adaptation Guide, which is binding: Connectors and SOC 2 (H to M), Operations and Hardening (N to V, adapted), Differentiation and Moat (W to AC, adapted), Platform completion (AD to AI, adapted), and the Calibration, Efficacy and Decision Intelligence addendum (AJ to AN). The original V2 Master Build Prompt serves as the specification library, not the execution order.

It changes the operating mode. The underlying prompts say "stop and confirm" after each phase. That instruction is replaced by the automated Phase Gate in Section 3. You run autonomously, phase after phase, until the entire build is finished, and the gates below are what keep you honest in place of a human checkpoint.

The em-dash ban from the prompts still applies here and everywhere: never use a long em-dash, in code, copy, reports, or status output.

---

## 1 · RUN MODE

Execute all phases A through AN in order, autonomously, without pausing for human confirmation, subject to the gates and stop rules below. Do not wait for me between phases. Advance only when a phase passes its gate. Stop only on a genuine blocker per Section 6.

You own the loop. For each phase you build, you verify, you write a drift report, you remediate until green, and only then do you advance. You do not move the goalposts to get there.

---

## 2 · THE PER-PHASE LOOP

For every phase, in this order:

1. **Build.** Implement the phase exactly as its prompt specifies.
2. **Verify.** Run the full verification set: `pnpm run typecheck`, `pnpm run build`, the phase's own acceptance checks, the global regression contract from Part 0 of the master prompt, the em-dash sweep, and, once Phase R exists, the automated test suite in CI mode.
3. **Drift report.** Produce the drift report for the phase per Section 4.
4. **Remediate.** If any check fails or the drift report flags blocking drift, enter the remediation loop in Section 5.
5. **Advance.** Move to the next phase only when the Phase Gate in Section 3 is satisfied.

---

## 3 · THE PHASE GATE (what replaces human confirmation)

A phase passes its gate only when all of the following are true:

- `typecheck` and `build` are clean.
- Every acceptance check listed for that phase passes, actually, not nominally.
- The full regression contract from Part 0 still holds.
- The em-dash sweep returns zero in user-facing prose and data.
- The drift report shows no unresolved blocking drift.

On pass, auto-advance to the next phase. On an unresolvable blocker, hard stop per Section 6. There is no partial pass that advances. A phase is green or it is blocked.

---

## 4 · THE DRIFT REPORT (built in, every phase)

At the end of every phase, write `docs/drift/phase-<id>.md` and update a running `docs/drift/INDEX.md`. The drift report compares what you actually built against what the phase required, and names every divergence. It contains:

- **Phase id and name.**
- **Requirements checklist.** Every requirement from the phase prompt, each marked done, partial, or skipped, with one line of evidence (a file path and symbol, or a one-line proof). Partial or skipped requires a reason.
- **Drift items.** Every deviation from the spec, each classed as blocking or acceptable, with a reason. Actively check for and report these categories, because they are the known failure modes:
  - Stubbed, mocked, scripted, hardcoded, or faked output where real output was required. The Confounder stage and the cortex telemetry are the highest-risk targets. On every phase that touches them, the report must explicitly affirm they are real, running, per-tenant output, not placeholders.
  - Renamed tables, substituted libraries, or restructured layout done to route around a problem.
  - Any regression-contract surface that changed behaviour.
  - Scope added beyond what the phase asked for.
  - Any silent assumption or default you took.
- **Decisions taken.** Any embedded decision where you applied the recommended default rather than pausing (for example the client-viewer access scope in Phase T, the cost-cap values in Phase N, the connector framework deployment choice). Log each so I can review them after the run.
- **Test and verification summary.** What ran, what passed, what you fixed.
- **Verdict.** Pass, pass with noted acceptable drift, or blocked.

The drift report is not paperwork. It is the mechanism that lets the build run without me watching, by making every corner you could have cut visible after the fact.

---

## 5 · THE REMEDIATION LOOP

On any failed check or blocking drift:

1. Diagnose the actual cause. Do not guess.
2. Fix it.
3. Re-run the full phase verification from Section 2 step 2.
4. Regenerate the drift report, appending the remediation iteration so the history is visible.
5. Repeat until the phase is green, up to a budget of 5 iterations on the same failure.

Hard rules during remediation, these are not negotiable:

- Never mark a check as passing unless it actually passes.
- Never weaken, skip, disable, or delete a test or an acceptance criterion to make a phase go green. Changing the goalposts is a worse failure than the original bug.
- Never fake, stub, or script output to satisfy a check.
- Never rename a table, swap a library, or restructure to dodge a problem instead of solving it.

If 5 iterations do not clear the same failure, stop per Section 6.

---

## 6 · HARD STOP CONDITIONS

Stop autonomy and write `docs/drift/STOP.md` when any of these occur. Do not work around them.

- A required capability genuinely cannot be implemented, for example a real Confounder needs a model call that keeps failing, or an external dependency is unavailable.
- The remediation budget is exhausted on the same failure.
- Satisfying a phase would require violating a non-negotiable: faking the Confounder or telemetry, breaking the regression contract, an em-dash in shipped content, or weakening a security control.
- An action would be irreversible or risky and is outside the build scope (deleting data, changing access controls on something you did not create, anything touching real client systems before the connected-mode phases are reached and validated).

The STOP report names the blocker, what you tried, the drift up to that point, and exactly what you need from me to continue. Then wait.

---

## 7 · ANTI-GAMING RULES (the core of running without a human)

Removing the human checkpoint removes the thing that caught a faked pass. These rules are the replacement. They override any pressure to "just get the phase green."

- The Confounder, the three model seats, and the cortex telemetry are real or the build is failed. No stubs, no scripts, no static demo data standing in for a live run. Affirm this explicitly in the drift report on every phase that touches them.
- Tests and acceptance criteria are fixed targets. You do not edit them to pass. If a criterion is wrong, flag it in the drift report and stop, do not quietly change it.
- Every default on an embedded decision is logged in the drift report, never silently chosen and forgotten.
- A green phase with honest noted drift is acceptable. A green phase achieved by hiding drift is the one outcome this whole protocol exists to prevent.

---

## 8 · RECOMMENDED REVIEW POINTS (you do not pause, I read)

You run straight through. But the build is designed so I can review the drift reports at the highest-risk boundaries without stopping you. Surface a clear milestone marker in the drift index at the end of:

- Phase C, the Confounder and cortex engine, the differentiator.
- Phase G, the parity gate against V1, side by side.
- Phase H and Phase I, where client-data architecture begins.
- Phase K, per-tenant isolation and keys.
- Phase T, the client onboarding experience and tenant fencing.
- Phase X, the benchmarking privacy design, where the network effect meets the derive-and-discard promise.
- Phase AI, the final platform verification and consolidated report.
- Phase AJ, the calibration ledger: the Brier maths and the honesty of the published score.

If I have set `PAUSE_AT_MILESTONES = true` at the top of the run, treat these five as hard stops and wait for my confirmation. If it is false, mark them clearly in the index and continue. Default is false, full autonomy.

---

## 9 · REPLIT REALITY (so the run actually completes)

This is a large build, roughly thirty-five phases under the greenfield plan including the calibration addendum. Be realistic about the environment:

- You will likely checkpoint and may hit time or usage limits before the whole thing is done in one sitting. That is expected, not a failure.
- The build is resumable by design. The drift `INDEX.md` is the source of truth for progress. On any restart, read the index, find the last phase that passed its gate, and continue from the next one. Do not restart from Phase A.
- Commit at the end of every passed phase, after its gate is satisfied and its drift report is written. Use the message format `Phase <id>: <name> [drift: <verdict>]` and tag the commit `phase-<id>`. One phase, one commit, one tag. This makes the run resumable from the last commit and makes every phase an independent, reviewable diff for drift comparison. Never bundle multiple phases into one commit.
- The fast-seeding work in Phase D already makes pipeline runs resumable. Lean on that. Never re-run a passed phase to "be safe," it wastes budget and risks regressions.
- If you stop for any reason, leave the index in a state where a fresh session can pick up exactly where you left off, with the last drift report explaining the current state.

---

## BOTTOM LINE

Run the whole thing, phase by phase, without waiting on me. Test every phase, remediate until it is truly green, and write an honest drift report each time that names anything you skipped, assumed, defaulted, or could not do. The drift reports plus the anti-gaming rules are what let this run autonomously without the build quietly drifting away from what it is supposed to be. The one unforgivable outcome is a phase that looks done but faked the part that mattered. Everything in this protocol exists to make that impossible to hide.
