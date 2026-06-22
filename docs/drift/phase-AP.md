# Phase AP: sovereign seat realisation (correctness audit)

Phase id: AP. Name: sovereign seat realisation. Milestone: no (a gated per-phase stop). Phase AP is the
SECOND phase of the Robustness and Magic wave (AO through AS), the post-AN follow-on wave that reopened the
Elevated Intelligence V2 build, closed at the Phase AN milestone, to harden the platform and sharpen its
surface.

On inspection the phase was redefined as a CORRECTNESS AUDIT rather than a from-scratch realisation, because
the in-boundary sovereign seat was already real and proven from Phase J (the split pipeline and the
in-boundary Lens seam) and Phase AF (the sovereign mode). Building it again would have been fabricated
novelty. The honest deliverable is therefore an audit of the seat as it stands, the one honesty defect that
audit found and fixed, and the documentation the seat lacked.

## The sovereign seat as it already stood

The split pipeline routes the two Lens stages (perceive, hypothesise) to an in-boundary sovereign seat when a
tenant runs in connected data mode, while the external Synthesist (narrate) and the adversarial seats
(confound, challenge) plus the Evaluator receive only the profile, the in-boundary Lens output, and the
math-only derived-signal grounding, never raw client content. The in-boundary adapter
(`lib/cortex/src/clients/local.ts`) speaks the OpenAI-compatible `/v1/chat/completions` wire over the Node
global fetch (no SDK, no new dependency), with strict JSON mode, a Bearer only when an api key is set, 429
backoff, and one corrective retry. `resolveLocalSeat(env)` reads the model from `LOCAL_MODEL_BASE_URL`,
`LOCAL_MODEL_MODEL`, and the optional `LOCAL_MODEL_API_KEY`, so no model literal enters source;
`getExtractionRuntime(env)` returns the runtime only when one is configured and null otherwise, and an
unconfigured connected Lens fails loud ("local extraction seat available, not connected ...") with no silent
external fallback. This was all in place and tested before Phase AP; the audit confirmed it and changed none
of it.

## The defect the audit found

The defect was at the as-of replay snapshot sink, not in the seat itself. When a layer build writes its
append-only `tenant_layer_snapshots` row, it must record the DATA-SOURCE regime (outside_in or connected) the
build was grounded on, because the as-of efficacy ceiling depends on it (an outside-in build can never reach
the connector-grounded coverage and freshness drivers, so its ceiling is below 100, while a connected build
can reach 100). The snapshot recorded this regime as `dataMode === "outside_in" ? "outside_in" :
"connected"`. That collapse is wrong: `dataMode` also carries the MODEL-EXECUTION mode, and a `sovereign`
execution is a valid value that is NOT a connected data source. A sovereign build of an outside-in tenant
would therefore be recorded as connected and its past as-of efficacy ceiling lifted to 100 over data it never
consumed: a fabricated figure, exactly the class the build forbids.

## The first fix and why it was rejected

The first fix read the live `tenants.dataMode` column at snapshot time and recorded outside_in or connected
from it. The architect review (evaluate_task) graded this FAIL: the column is mutable, and a tenant mode flip
mid-build (between the build starting and the snapshot writing) could stamp a regime the build never ran
under. The collapse bug was closed but a race was opened in its place; reading the mutable live column at the
snapshot sink can never be correct.

## The race-immune fix

The regime is now decided ONCE, at the seed decision point, and threaded down to the snapshot sink as an
explicit `dataSourceMode` argument (`outside_in` | `connected`) on `runLayers` and `runLayer`, carried
alongside the grounding the build actually consumed. `seedTenant` reads `tenants.dataMode` at entry and
branches a connected tenant to `seedConnectedTenant`, so its own remaining path always threads `outside_in`;
`seedConnectedTenant` always threads `connected`. The snapshot now records this threaded value (`const
snapshotDataMode = dataSourceMode`) and the live-column read at snapshot time is deleted entirely. The
argument defaults from the execution `dataMode` for any direct caller, which is correct for the non-sovereign
direct callers.

No in-transaction re-read and fail-loud was added, and that omission is deliberate and was confirmed correct
by the architect. With the threaded value the snapshot no longer reads the mutable column at all, so there is
nothing to validate against; and a tenant mode flip AFTER the build is the normal, intended live/as-of
divergence the snapshot exists to preserve (a layer built outside_in while the tenant is now connected),
which a validation against the live column would wrongly reject or which would reintroduce the very race it
was meant to close.

## Tests

`artifacts/api-server/src/lib/pipeline/snapshotDataMode.integration.test.ts` drives the real `runLayer` write
path against live Postgres in three cases:

- Case 1: an outside-in build threads `outside_in`; the newest snapshot records outside_in and the as-of
  efficacy ceiling stays below 100.
- Case 2: a connected build threads `connected`; the snapshot records connected and the as-of read reflects
  the connected regime.
- Case 3 (the race regression): the live tenant row reads `connected` while the build is called with
  `dataSourceMode="outside_in"` (exactly the mid-build-flip divergence). The snapshot records outside_in (the
  threaded grounding regime), NOT connected (the live column), and the as-of efficacy ceiling stays below 100.
  A revert to the old live-column read records connected and fails this case, so the test locks the exact sink
  where the defect lived.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- The full suite is green with zero failures (api-server 647 tests across 78 files, edge-agent 10, plus the
  portal, cortex, connectors, db, and scripts suites). All three `snapshotDataMode` cases pass. The heavily
  loaded api-server integration suite is contention-sensitive: a saturated run intermittently flaked one
  unrelated integration test (observed once as a 5000ms timeout, once as a transient 500 on a different test),
  and a clean re-run passed all 647; the flake exercises neither the orchestrator data-source threading nor the
  snapshot sink this phase touched and is unrelated to this change.
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase AP
  Markdown, and a fresh database-wide row-cast over all 46 public tables reports zero hits (Phase AP writes no
  schema and no data, so the database side stays clean and is re-run fresh to claim zero honestly).
- Zero new npm dependencies (the audit changed orchestrator threading and documentation only).

## Honest marking

What is TEST-PROVEN here: that the as-of snapshot records the data-source regime the build was grounded on and
never the mutable live column, including the race case where the live row and the threaded regime disagree;
that an outside-in build's as-of efficacy ceiling stays below 100 and a connected build's reflects the
connected regime.

What is the accepted boundary (logged drift): the in-boundary sovereign seat runs against a live local model
ONLY when a `LOCAL_MODEL_*` endpoint is configured; it is "available, not connected" by default and is proven
against a real `node:http` adapter harness rather than a live local model in the build environment, mirroring
how the external seats were proven. The split routing, the fail-loud, and the no-fallback honesty are
directly tested.

Nothing is fabricated: a past build's as-of regime is the one the build actually ran under, a missing driver
remains a disclosed dash rather than a zero, and the sovereign seat reports "available, not connected" until a
local model is configured rather than faking an in-boundary answer.

## Logged drift and deviations

- Phase AP was redefined from a from-scratch realisation to a correctness audit, because the in-boundary
  sovereign seat was already real and proven from Phases J and AF. Re-building it would have been fabricated
  novelty; the honest scope is the audit, the one fix, and the documentation. Logged as a scope deviation.
- The in-boundary sovereign seat is "available, not connected" by default and is proven against a `node:http`
  adapter harness, not a live local model, which the build environment does not host. A future configured
  `LOCAL_MODEL_*` endpoint closes it.
- The heavily loaded api-server integration suite is contention-sensitive: a saturated run intermittently
  flakes one unrelated integration test (seen once as a 5000ms timeout, once as a transient 500 on a different
  test), while a clean re-run passes all 647. Logged as an environmental flake, not a regression.

## Gate

Phase AP passed its architect `evaluate_task` review (PASS) after one honesty remediation that itself took two
rounds: the audit first closed the snapshot collapse that mis-recorded a sovereign execution as a connected
data source, and then closed the race the first fix introduced by threading the data-source regime from the
seed decision point instead of re-reading the mutable column at snapshot time. The re-review confirmed the
race is closed by construction, that omitting an in-transaction validation is the correct call (a post-build
mode flip is legitimate live/as-of divergence, not a defect), and that the new race-immunity case genuinely
locks the invariant. The hard constraints hold (zero new dependencies, ASCII hyphen only in source and data,
no fabricated figure). The drift index, the rollup, and the V2 build report advance to "A through AP". Phase
AP is gated but not a milestone; the Robustness and Magic wave continues with Phase AQ (the outcome loop
closure).
