---
name: Interphase drift reconciliation
description: Why out-of-band task-queue merges silently break the per-phase drift ledger, and how to reconcile before resuming a lettered phase.
---

# Interphase drift reconciliation

Commits that land between lettered build phases (task-queue merges: test infra, perf,
a11y, model swaps, tooling) do NOT go through the per-phase drift protocol. They change
real code but leave `docs/drift/INDEX.md`, `rollup.md`, and `docs/build-report-v2.md`
reading the old "A through <lastphase>", and the recorded suite total drifts behind the
tree. The drift ledger silently desyncs from the working tree.

**Why:** `INDEX.md` is the declared single source of truth for build progress, but nothing
enforces that out-of-band merges update it. So before opening the next phase you must
treat the ledger as possibly stale, not authoritative.

**How to apply:** Before resuming a lettered phase, diff the last phase commit against HEAD
(`git log/diff <lastphase-commit>..HEAD`), re-run the gates (typecheck, build, test) and the
two-sided long-dash sweep on HEAD, then reconcile with a NOT-a-new-phase record. The
established convention (see `audit-post-X.md`, `audit-post-AN.md`, `audit-post-AS.md`) is:
write `docs/drift/audit-post-<lastphase>.md`, add ONE dated note line to `INDEX.md`, add a
note plus any still-live items to `rollup.md`, and write NO `build-report-v2.md` phase
section (a reconciliation advances no gate). The rollup header phase tag stays at the last
real phase.

**Recurring risk this surfaced (the ambient DATABASE_URL class):** the per-worker test
harness runs `CREATE DATABASE ... TEMPLATE` and the `.replit` postMerge hook runs a Drizzle
`push-force`, both against whatever `DATABASE_URL` is set, with no refuse-on-production
guard. Safe only because the workspace DB is non-production; flag it whenever production
credentials could enter the workspace.
