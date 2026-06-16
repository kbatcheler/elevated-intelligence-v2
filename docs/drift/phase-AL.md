# Phase AL: the decision ledger and pre-mortem

Phase id: AL. Name: the decision ledger and pre-mortem. Milestone: no (a gated per-phase stop; the build
advances to Phase AM after the AL gate). Phase AL is the second phase of Stage 6, the final stage, run
under the owner authorization that cleared the AJ milestone pause to execute the AK-AL-AM-AN sequence
linearly.

Phase AL turns the platform from an advisor that talks into an advisor that is held to account. Phase AK
asked how good the DATA feeding a layer is; Phase AL records what a board actually DECIDES against the
intelligence and grades those decisions over time. Three things land together: a decision ledger (one
hash-chained row per commit, defer, or reject, snapshotting the exact recommendation, its confidence, and
its evidence at decision time), an on-demand pre-mortem (a REAL Confounder cortex call that imagines the
decision has already failed and returns ranked failure modes with watched early-warning indicators wired
into the Phase Z push evaluator), and a board-grade decision audit timeline (a read-model that joins
decisions to their pre-mortems, committed actions, graded outcomes, and AJ forecasts, with a running
realised value and an "overruled and right" verdict derived at read time). Zero new npm dependencies;
ASCII hyphen only in source and in data; no fabricated telemetry, health, or output.

## The decision ledger

Two honesty-bearing tables are added (`lib/db/src/schema/decisionRecords.ts`,
`lib/db/src/schema/preMortems.ts`), taking the base-table count from 40 to 43 (`decision_records`,
`pre_mortems`, `pre_mortem_indicators`).

`decision_records` holds one row per board-grade decision a human takes on a recommended action, in one of
three kinds (`decision_kind`: `commit`, `defer`, `reject`). A commit also creates a committed action (the
existing Phase W path) and binds its AJ forecast; a defer or a reject records the decision WITHOUT
committing, leaving the recommendation in the diagnosis and capturing that it was deliberately not taken.
Each row records what was decided, who decided it (`decidedBy`, set null on a user delete so the audit
outlives the seat), when, the system recommendation and its confidence and basis AT THAT MOMENT
(`recommendedTitle`, `recommendedDetail`, `recommendedImpact`, `recommendedValueUsd`, `systemConfidence`,
`systemBasis`), the human's rationale, the linked `forecastId`, and the provenance entry the decision
appended (`provenanceContentHash`, never null).

The honesty boundaries the rest of the system draws are kept exactly:

- `recommendationHash` is a sha256 over the canonical recommendation snapshot, so the row binds to the
  EXACT recommendation it acted on; a later refresh that changes the action is honestly shown as a
  different recommendation, never silently re-pointed.
- `recommendationVerified` records whether the snapshot was read SERVER-SIDE from the persisted layer
  content (a defer or reject, and a commit naming an `actionRef`) or came from the client with no system
  reference (a freeform commit). The board audit must never present an operator-typed action as a verified
  system recommendation, so the flag is the honest distinction; it defaults true and only a no-ref commit
  records false.
- `evidenceRefs` (jsonb, default `[]`) snapshots the provenance refs grounding the layer's diagnosis at
  decision time: references into the append-only ledger (claimPath plus contentHash), never raw evidence.
  An empty array is the honest state for a layer with no graded claims yet (an outside-in tenant), never
  fabricated.
- `contradictsRecommendation` is computed once at decision time (a defer or reject contradicts; a commit
  follows), never re-derived from mutable state, so "overruled and right" can be read consistently later.
- A decision is a recorded human act, not a model call, so it ALWAYS appends one hash-chained provenance
  entry; the pre-mortem is the model call and carries its own completed-or-failed lifecycle.

## Recording a decision

`artifacts/api-server/src/lib/decisions/decisionRecord.ts` is the writer. `recordDecisionTx` runs inside a
supplied transaction (so a commit's action insert, forecast link, and decision record are atomic): it
dash-sanitises the snapshot text, hashes the canonical recommendation, hashes the canonical evidence-ref
set into the decision's provenance source reference (so the entry binds to the EXACT evidence the
recommendation rested on, not just its text), appends exactly one provenance entry under
`<layer>.decision.<anchor>`, and inserts the row. The human's rationale is hashed into the provenance
digest, never embedded raw, so the ledger reveals a reason existed without leaking its text.

The two architect-flagged gaps from the first review are closed here:

- A decision never trusts a client to describe what the system recommended. `loadRecommendationSnapshot`
  reads the recommendation SERVER-SIDE from the live layer content (parsing the `actionRef` and requiring
  it to resolve to an `actions[n]` finding), returning typed outcomes (`layer_not_found`,
  `finding_not_found`, `not_an_action`, `ok`). The commit route (`POST /tenants/:id/actions`) calls it
  BEFORE the write transaction when an `actionRef` is named, mapping the outcomes to `404 layer_not_found`,
  `404 action_not_found`, and `422 not_an_action` so a misnamed recommendation fails the whole commit with
  no half-written action; on success the decision snapshots the SERVER recommendation with
  `recommendationVerified=true`. A freeform commit with no `actionRef` keeps the client snapshot, honestly
  marked `recommendationVerified=false`.
- `snapshotLayerEvidence` captures the provenance refs grounding a layer right now: the latest ledger
  entry per claimPath under the layer (provenance is append-only, so a re-grade appends a fresh entry and
  the newest is the live evidence), EXCLUDING the ledger's own meta prefixes (`<layer>.decision.`,
  `<layer>.challenge.`, `<layer>.premortem.`, and the bare layer key), returning references sorted by
  claimPath. It runs for every decision kind, so a commit, a defer, and a reject all bind to the evidence
  as it stood.

`recordStandaloneDecision` records a defer or a reject: it reads the recommendation server-side (verified
by construction), snapshots the evidence, references the newest unresolved, unbound `action_outcome`
forecast for the action BY REFERENCE only (never binding or resolving it), and writes the decision in one
transaction.

## The on-demand pre-mortem

`artifacts/api-server/src/lib/decisions/preMortem.ts` (`runDecisionPreMortem`) mirrors the Phase AA
interactive challenge exactly: a REAL Confounder cortex call (`runPreMortem` from `@workspace/cortex`,
with its prompt in `lib/cortex/src/prompts/preMortem.ts` and its strict output schema in
`lib/cortex/src/schemas/preMortem.ts`), real billed telemetry recorded through `recordModelUsageSafe`, and
an honest completed-or-failed lifecycle. It loads the decision, the tenant profile, the layer descriptor,
and the layer narrative and confounders as CONTEXT for a faithful imagination of failure, and reuses the
Confounder seat so it honours the deployment-wide sovereign regime.

A completed run writes, in a SINGLE transaction, the ranked failure modes (each `{ rank, title, mechanism,
likelihood, earlyWarning }`, dash-sanitised and rank-sorted), the Confounder's residual-risk note, one
hash-chained provenance entry under `<layer>.premortem.<decisionId>`, and one watched indicator per
failure mode in `pre_mortem_indicators`. A failed run (a model call that returned no usable result) writes
an honest `failed` row with the error and the real telemetry, and NO provenance entry and NO indicators,
never a fabricated forecast of doom.

`pre_mortem_indicators` normalises each failure mode's single observable early sign into a row the push
evaluator can watch with a stable, idempotent key. An indicator is a thing to MONITOR, real persisted
state the board should be reminded to watch, never a fabricated breach: the Phase Z `premortem_indicator`
push rule (`pushEvaluator.ts`, `pushMath.ts`) surfaces active and triggered indicators on open decisions
with a `premortemIndicatorDedupeKey(indicatorId, status)` so a status change mints a fresh notification
while an unchanged active indicator never notifies twice. The owner or provider can move an indicator
through `active`, `triggered`, and `cleared` over `POST /tenants/:id/pre-mortem-indicators/:indicatorId/status`.

## The board-grade audit timeline

`artifacts/api-server/src/lib/decisions/timeline.ts` (`getDecisionTimeline`) is a read-model that joins
the decision ledger to its pre-mortems and their indicators, the committed action each commit created,
that action's latest graded outcome measurement, and the AJ forecast it concerns. Every figure is read
from persisted state:

- The running realised value (`runningRealizedValue`, pure and unit-tested) is the cumulative sum of REAL
  graded measurements in chronological order; only a terminal `realized` or `missed` measurement moves the
  total, a pending or on-track one carries the prior cumulative forward unchanged, and the value is never a
  projection.
- "Overruled and right" (`deriveOverruledStatus`, pure and unit-tested) is derived at read time, never
  stored as a flag that could drift: a decision that contradicted the recommendation is `right` when its
  `action_outcome` forecast later resolves FALSE (the system's bet that the action would have succeeded
  was wrong, so the human's contrarian call was vindicated), `wrong` when it resolves TRUE, and honestly
  `pending` until the forecast resolves; a commit followed the advice, so it is null.

The entry carries the recommendation snapshot, the `recommendationVerified` flag, the `evidenceRefs`, the
committed-action status, the realised value and measurement status, the linked forecast probability,
resolution, outcome, and Brier score, the pre-mortems with their indicators, and the cumulative realised
value; the summary totals the commits, defers, rejects, the overruled right/wrong/pending counts, and the
identified-versus-realised value.

## Routes

`artifacts/api-server/src/routes/tenants.ts`:

- `POST /tenants/:id/actions` (the existing commit route) now server-snapshots the recommendation by
  `actionRef` and writes a `commit` decision record in the same transaction as the action and its forecast
  link.
- `POST /tenants/:id/decisions` records a `defer` or a `reject` (rationale required), behind
  `requireTenantAccess`; a client-viewer is forbidden.
- `POST /tenants/:id/decisions/:decisionId/pre-mortem` runs the on-demand Confounder pre-mortem; a
  client-viewer is forbidden from spending a model call.
- `GET /tenants/:id/decisions/timeline` returns the audit timeline for any tenant seat.
- `POST /tenants/:id/pre-mortem-indicators/:indicatorId/status` records an indicator transition.

## Portal

- `artifacts/portal/src/types.ts` adds the decision, pre-mortem, indicator, and timeline types.
- `artifacts/portal/src/lib/decisionApi.ts` is a framework-free client mirroring the existing API clients:
  `fetchDecisionTimeline`, `recordDecision`, `runPreMortem`, and `setIndicatorStatus`, each with typed
  outcomes and a 401 mapped to an unauthorized signal so the caller can log out.
- `artifacts/portal/src/components/pages/DecisionsPage.tsx` and
  `artifacts/portal/src/components/layer/DecisionControl.tsx` render the audit timeline (the recommendation
  at the time with a verified-or-unverified pill, the evidence-ref count, the pre-mortems and their watched
  indicators, the overruled verdict, and the running realised value) and the per-action decision control,
  each with distinct loading, ready, empty, and error states and a dash, never a fabricated zero, for a
  missing figure.

## Tests

- `artifacts/api-server/src/lib/decisions/decisionRecord.test.ts` (5). The pure helpers: the canonical
  recommendation serialisation and its hash binding to the exact version, the canonical evidence-ref
  serialisation, and the `contradictsRecommendation` derivation.
- `artifacts/api-server/src/lib/decisions/timeline.test.ts` (10). The pure timeline math:
  `runningRealizedValue` accumulating only graded measurements in chronological order and carrying a
  pending decision forward, and `deriveOverruledStatus` returning right, wrong, pending, and null across
  the forecast-resolution cases.
- `artifacts/api-server/src/routes/decisions.integration.test.ts` (17). Against live Postgres with REAL
  hash-chained provenance seeded via `appendEntry`: a commit server-snapshots the LIVE recommendation and
  its evidence (a deliberately wrong client title and confidence are overridden by the server values,
  `recommendationVerified=true`, the evidence refs are exactly the latest-per-claimPath set, sorted, with
  the decision and challenge meta entries excluded), the commit guard paths (a bad action index 404s, a
  non-action ref 422s, a missing layer 404s, all BEFORE any write), a no-`actionRef` commit keeps the
  client snapshot honestly `recommendationVerified=false` with the evidence still snapshotted, a defer
  snapshots the exact recommendation and is marked overruled, the defer route guards (auth, client-viewer
  403, invalid input, 404 unknown layer, 422 non-action, 404 bad index), the timeline read returns the
  pre-mortems and the overruled verdict for any tenant seat, the pre-mortem route guards (client-viewer
  403, 404 on an unknown decision), and the indicator-status route (client-viewer 403, invalid status,
  404 unknown, and the triggered then cleared then active transitions).
- `artifacts/portal/src/lib/decisionApi.test.ts` (17). The client outcomes for all four calls including the
  unauthorized and malformed-payload guards.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 1005 tests (api-server 581 across 65 files, portal 263 across 21 files, cortex 110
  across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4), up 49 from
  Phase AK's 956. The new tests are api-server `decisionRecord` (5), `timeline` (10), and the
  `decisions.integration` suite (17), and portal `decisionApi` (17).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase
  AL Markdown, and a fresh database-wide cast over all 169 public text and jsonb columns across the 43
  base tables (three tables added in AL) reports zero hits.
- Zero new npm dependencies (workspace packages and Node built-ins only; the pre-mortem reuses the existing
  Confounder seat and `drizzle-orm` reads).

## Honest marking

What is TEST-PROVEN here: the pure recommendation and evidence canonicalisation and hashing, the
`contradictsRecommendation` derivation, the pure timeline math (`runningRealizedValue` and
`deriveOverruledStatus`); and, against live Postgres, the commit server-snapshot overriding a wrong client
description, the exact latest-per-claimPath evidence snapshot with meta excluded, the commit and defer
guard paths failing before any write, the no-ref unverified commit, the defer snapshot and overruled mark,
the timeline read with seeded pre-mortems and the overruled verdict, the pre-mortem and indicator route
guards, and the indicator status transitions. The pre-mortem COMPLETED path's failure modes and indicators
are exercised in the timeline test via a directly-seeded completed pre-mortem fixture and the watched
indicators flow through the Phase Z push rule.

What is SOURCE-REVIEWED rather than test-proven (the accepted LOWs): the on-demand pre-mortem's REAL
Confounder cortex call runs only inside a real paid model call the suite deliberately does not run, so the
elicitation prompt and the completed-run model output are source-reviewed while the route guards, the
failed-run handling, the indicator wiring, and the timeline rendering of a completed pre-mortem ARE tested
(this mirrors the AC challenge re-reason and the AJ Evaluator-prompt LOWs); and the portal decision
surfaces (`DecisionsPage`, `DecisionControl`) are source-reviewed while the `decisionApi` client behind
them is unit-tested (mirroring the AE, AF, AG, AJ, and AK portal items).

Nothing is fabricated: an empty evidence set shows as an empty set, a failed pre-mortem shows an honest
failed row with no provenance and no indicators rather than an invented forecast of doom, an unverified
commit is honestly flagged rather than dressed up as a system recommendation, and a pending decision
carries the prior cumulative realised value forward rather than projecting a number.

## Logged drift and deviations

- The on-demand pre-mortem's real Confounder call is source-reviewed, not run by the suite (AL). The
  ranked failure modes and the residual-risk note are produced only inside a real paid Confounder call the
  suite does not run, so the prompt and the completed-run model output are source-reviewed; the route
  guards, the failed-run row, the indicator normalisation and push wiring, and the timeline rendering of a
  seeded completed pre-mortem ARE tested. Accepted as logged drift, mirroring the AC and AJ real-model
  items; a future injected-Confounder test or a real seed can close it.
- No portal-side rendering test for the decision surfaces (AL). `DecisionsPage` and `DecisionControl` are
  source-reviewed; the `decisionApi` client behind them IS unit-tested and the decision, pre-mortem,
  timeline, and indicator routes ARE integration-tested. Accepted as logged drift, mirroring the AE, AF,
  AG, AJ, and AK portal items; a future lightweight portal test can close it.

## Gate

Phase AL passed its architect `evaluate_task` review (PASS) after one remediation round that closed two
blocking gaps from the first review. First, the decision now snapshots the provenance evidence the
recommendation rested on (`evidenceRefs` plus `recommendationVerified` columns, `snapshotLayerEvidence`
keeping the latest entry per claimPath and excluding the meta prefixes, the canonical evidence set hashed
into the decision's provenance entry) so the board audit shows WHAT grounded the advice even after the
layer is refreshed. Second, the commit route now reads the recommendation SERVER-SIDE by `actionRef`
before the write transaction (returning the 404 and 422 guards before any action is written) and snapshots
the verified server recommendation, so a decision can never present a client-typed action as a system one;
a freeform commit is honestly marked unverified. The re-review confirmed the decision ledger is
hash-chained and binds to the exact recommendation and evidence, the pre-mortem is a real Confounder call
with an honest completed-or-failed lifecycle whose indicators feed the push rule, the timeline derives the
running realised value and the overruled verdict from persisted state, and the hard constraints hold (zero
new dependencies, ASCII hyphen only in source and data, no fabricated figure). The drift index, the
rollup, and the V2 build report are updated to "A through AL". Phase AL is not a milestone; the build
advances to Phase AM (the as-of replay and the diligence pack).
