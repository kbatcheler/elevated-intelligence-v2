# Phase AN: the final verification and the consolidated report (closes Stage 6 and the whole build)

Phase id: AN. Name: the final verification and the consolidated report. Milestone: yes (the closing phase
of Stage 6, the final stage, and of the whole Elevated Intelligence V2 build). Phase AN is the fourth and
last phase of Stage 6, run under the same owner authorization that cleared the AJ milestone pause to execute
the AK-AL-AM-AN sequence linearly.

Phase AN builds NO product feature and changes no product code. Its only deliverables are (1) a fresh,
full re-verification that every Stage 6 guarantee and every load-bearing invariant of the whole build still
holds and is pinned by a test that turns red when broken, and (2) a consolidated build-report append that
records, in one place for an outside reader, the scoring design (the data-efficacy index and the
Brier-scored calibration ledger), the efficacy index weights, the decision and forecast schemas, and the
honest-labelling rules that run through the entire system. The hard constraints continue to hold: zero new
npm dependencies; ASCII hyphen only in source and in data; no fabricated telemetry, health, or output; the
per-phase drift protocol updated in lockstep.

## What this phase verified

The configured workflows were re-run fresh, in the protocol order, with typecheck and build never run
concurrently with the test suite:

- `typecheck` is clean across the workspace (exit 0; `tsc --build` for the libraries, then a per-project
  `--noEmit` for `api-server`, `portal`, `edge-agent`, and `scripts`).
- `build` is clean (exit 0; the portal builds to 1765 transformed modules, the api-server bundles to
  `dist/index.mjs`).
- `test` is green at 1034 tests with zero failures: api-server 610 across 69 files, portal 263 across 21
  files, cortex 110 across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, and
  scripts 4. The only stderr lines in the run are warn-level logs emitted BY tests that deliberately
  exercise failure paths (an alert-delivery failure marked `failed` and never re-picked, a Sentry report
  that reports failed without throwing, a push digest whose tenant access was revoked since the event was
  recorded); each of those tests passes.
- The long-dash sweep is zero on BOTH sides: the source guard (`scripts/src/emDashGuard.ts`) is green over
  all authored source including this Phase AN Markdown, and a fresh database-wide cast over all 183 public
  text and jsonb columns across the 44 base tables reports zero hits.
- Zero new npm dependencies across the whole build (workspace packages and Node built-ins only; every
  external service is reached over the Node global fetch through an available-not-connected adapter, never an
  SDK).

## The invariants re-verified

Each named invariant of the final stage is pinned by a test that would turn red if the invariant broke, not
merely present:

- The Brier maths and the downward-only confidence calibration (`brierMath.test.ts`, 20). The score is
  `(p - o)^2` with a clamped probability and a fixed 0.25 baseline; an empty set is a null mean, never a
  fabricated zero; the confidence calibration is threshold-gated and never inflates a layer's confidence.
- Efficacy movement (`efficacyMath.test.ts`, 19; `efficacyService.test.ts`, 7). The index is a weighted
  average over the five named drivers; a driver that improves moves the index up and a null driver is
  disclosed as unmeasured rather than renormalised away to flatter the score; an outside-in tenant carries a
  structurally lower mode ceiling than a connected one because its connector-grounded drivers are
  structurally zero, and the index says why.
- Decision and audit tamper-proofness (`decisionRecord.test.ts`, 5; `timeline.test.ts`, 10; plus the
  provenance hash-chain `verifyChain` tests in the api-server suite). A decision snapshots and hashes the
  EXACT recommendation it acted on and appends exactly one hash-chained provenance entry, so a later refresh
  can never silently re-point the audit; the overruled verdict and the running realised value are derived at
  read time from resolved forecasts and graded measurements, never stored as a flag that could drift.
- As-of replay versus snapshot (`asOfMath.test.ts`, 9; `contentHash.test.ts`, 7; `asOf.integration.test.ts`,
  7 against live Postgres). The read-model reconstructs a past state from append-only, timestamped snapshot
  state ONLY; a layer with no build by the date is honestly unavailable; a diff delta is null (never zero)
  when a side is absent; and a post-as-of refresh that delete-replaces the live `derived_signals` cannot
  rewrite a past connected build's coverage or freshness because the as-of efficacy recomputes from the
  signal metadata captured on the snapshot.
- Diligence pack export (`pack.test.ts`, 6). The render shows modelled beside verified without collapsing
  the distinction, renders the overruled verdict off the exact `deriveOverruledStatus` contract, escapes
  every tenant-controlled string, states the outside-in ceiling honestly, and flags a broken provenance
  chain at its entry rather than asserting integrity.

## The consolidated report

The consolidated build-report append (the Phase AN section of `docs/build-report-v2.md`) records in one place,
for an outside reader, the four things the closing report owes: the scoring design (the data-efficacy index
and the Brier-scored calibration ledger, and how confidence, efficacy, and calibration are three distinct,
honestly-separated measures), the efficacy index weights (the documented, env-overridable default weights and
why they are weighted as they are), the decision and forecast schemas (what a decision record and a forecast
each persist, and the nullability boundary that keeps an unresolved forecast from carrying a fabricated
score), and the honest-labelling rules that run through the whole system (modelled versus verified, a dash for
a missing figure rather than a zero, available-not-connected for an unconfigured external seam, crypto-shred
and break-glass honesty, and no fabricated telemetry, health, or output).

## Honest marking

What is TEST-PROVEN at the close: every invariant listed above, by the named tests, all green in the
re-verification run. What is unchanged from the per-phase records: the accepted LOWs already logged across
the build (the source-reviewed read routes and portal surfaces of several phases, each with the service and
the render behind it tested) remain the only open drift, and AN adds none. Nothing in this phase is
fabricated: AN re-ran the real workflows and reports their real results, and it re-confirmed the two-sided
dash sweep against the real source and the real database rather than asserting a clean state.

## Logged drift and deviations

- Phase AN adds no new still-live drift item. It builds no product code; its deliverables are the
  re-verification and the consolidated report, and the open drift at the close is exactly the set already
  logged in the per-phase reports and carried in `rollup.md` (the source-reviewed read routes and portal
  surfaces, each with the service and render behind it tested).
- The milestone marking for AN follows the protocol's closing-phase convention (AI and AC are the prior
  closing phases): AN is a milestone because it closes a stage, and here it also closes the whole build, so
  the rollup and the index record the build as complete rather than advancing to a next phase.

## Gate

Phase AN passed its architect `evaluate_task` review (PASS, no remediation rounds and no blockers). The
review confirmed, over the Stage 6 source, that each load-bearing invariant is genuinely pinned by a test
that would turn red if it broke (the efficacy index moves the right way and outside-in versus connected
differ honestly with a structurally lower ceiling; the Brier score and the downward-only confidence
calibration cannot inflate; a decision record's recommendation snapshot is server-verified and the
provenance and timeline cannot be silently rewritten; the as-of read-model reconstructs from append-only
snapshot state only and a post-as-of refresh cannot rewrite a past connected build's efficacy; the diligence
pack renders modelled-versus-verified honestly and flags a broken chain rather than asserting integrity),
that there is no blocker to closing the whole build, and that the consolidated report scope is complete. The
drift index, the rollup, and the V2 build report are updated to "A through AN". Phase AN is the closing
milestone of Stage 6 and of the whole Elevated Intelligence V2 build: the build is complete and the rollup
records it as closed.
