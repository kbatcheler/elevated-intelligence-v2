# Drift rollup: Phases A through AR

A cross-phase view of every drift item logged so far, grouped by whether it is
still live, one-time and resolved, or a recurring environmental fact. Read the
per-phase reports for the full context; this is the at-a-glance comparison.

A post-AI verification audit (2026-06-16) is recorded below the Phase AI summary; it advanced no phase.
Phase AJ (the Brier-scored calibration ledger) followed it, and Phase AK (the Data Efficacy Index) then
opened Stage 6, the final stage, followed by Phase AL (the decision ledger and pre-mortem) and Phase AM (the
as-of replay and the diligence pack), then closed by Phase AN (the final verification and the consolidated
report). The Robustness and Magic wave (AO through AS) then reopened the build to harden it and sharpen its
surface; its first phase AO realises the priority connectors, its second phase AP audits and hardens the
sovereign seat, its third phase AQ closes the outcome loop, and its fourth phase AR hardens the operational
deploy posture, so the rollup now spans Phases A through AR.

Last updated after Phase AR (operational hardening, the fourth phase of the Robustness and Magic wave). AR
changes no product behaviour; it makes the deployment posture explicit and self-consistent across code, infra,
and the runbooks. Two of its three substrate pieces were already real from the post-AN remediation (the
config-gated `RATE_LIMIT_STORE` shared store and the fail-loud provenance append-only database role SQL); AR
keeps the code default `memory` so the checks run with no environment, does not rewrite the role SQL, and
instead states the production posture, logs it at boot, and aligns the Terraform with the runbook. A new pure
`startupPosture.ts` logs two boot posture lines once (a WARN on the in-memory single-instance rate-limit
default, an INFO on the shared `postgres` store; and the seven in-process scheduled loops with the
single-loop-runner requirement); `infra/gcp/main.tf` pins one always-on instance (min and max instance count 1,
was 0 and 4) and sets `RATE_LIMIT_STORE=postgres`; a new `docs/go-live-checklist.md` turns the deploy facts
into nine operator checkbox sections; `docs/deploy-readiness.md` gains a single-instance loop-runner section
with an honest steady-state-versus-rollout caveat; `docs/migration-runbook.md` marks the append-only step
REQUIRED and adds the env bullet, a Scaling posture paragraph, and the env-table row. A new pure
`startupPosture.test.ts` (five tests) proves the posture lines and their boot emission. Typecheck and build are
clean; the full suite is green (api-server 656 across 80 files, up from 651/79; edge-agent 10; plus portal,
cortex, connectors, db, scripts); the two-sided long-dash sweep is zero (the source guard over authored source
plus the infra and Dockerfile roots swept manually, and a fresh database cast over 185 text and jsonb columns
across all 44 public tables); zero new npm dependencies. The architect returned PASS after one
documentation-precision remediation (the rollout caveat). AR adds one new still-live drift item: the single
loop-runner is a deployment posture (one always-on instance), not code-level leader election, so a
multi-instance request tier needs a separate loop-runner instance or per-loop leader election.

Earlier, updated after Phase AQ (the outcome loop closure, the third phase of the Robustness and Magic wave). AQ
closes the outcome loop end to end: a new read model assembles, per committed decision and from persisted rows
only, the arc from a recommendation to a forecast to a realised-versus-predicted measurement and its Brier
score, exposed at a tenant-scoped `GET /api/tenants/:id/outcome-loop` behind `requireTenantAccess`; the commit
and measurement write routes now delegate to the same services the live seed walks, so the live and seed paths
cannot drift. A new portal page built from existing primitives renders the loop with provenance pills and four
honest data states (a missing figure is a dash, an open stage is null, never a fabricated zero), behind one new
nav line. `closeOneLoop` in the live seed stands up exactly one fully closed loop on the Hillman demo tenant
from real pipeline recommendation state, idempotently, recording realised equals predicted as a MODELLED basis
and skipping when the predicted value is null so it never fabricates a figure. A new
`outcomeLoop.integration.test.ts` proves the four cases (a closed loop scoring Brier 0.09, an open loop with a
null measurement and a null headline Brier, an empty tenant returning zero counts and a null mean, and a 401
without auth). Typecheck and build are clean; the full suite is green (api-server 651 across 79 files, up from
647/78; edge-agent 10; plus portal, cortex, connectors, db, scripts); the two-sided long-dash sweep is zero
(the source guard plus a fresh database cast over 185 text and jsonb columns across all 44 public tables);
zero new npm dependencies. The architect returned PASS with no blocking issue. AQ adds one logged drift item:
the portal uses American "organization" sitewide, so the new page matches that house convention and a
portal-wide British-English copy normalisation is deferred to Phase AS (which owns `artifacts/portal` in full);
the `OutcomeMeasurementStatus` `"realized"` enum and the `realizedValueUsd` fields keep American spelling as
data-contract identifiers while user-visible labels are British. A first test run launched during active
api-server editing flaked many tests on tsx-watch-reload DB-connection contention; a clean re-run with no
concurrent editing passed all 651 (the recurring environmental flake, not a regression).

Earlier, updated after Phase AP (the sovereign seat realisation, the second phase of the Robustness and Magic
wave, redefined on inspection as a CORRECTNESS AUDIT because the in-boundary sovereign seat was already real
and proven from Phases J and AF). The audit found and fixed one honesty defect at the as-of replay snapshot
sink: a build's recorded data-source regime collapsed a `sovereign` model-execution mode into a connected
DATA-SOURCE regime, which would have lifted a past build's as-of efficacy ceiling to 100 over data it never
consumed. The first fix re-read the live `tenants.dataMode` column at snapshot time and was rejected by the
architect as a mid-build flip race; the race-immune fix threads an explicit `dataSourceMode` decided once at
the seed decision point through `runLayers` and `runLayer`, recording the regime the build actually grounded
on and deleting the snapshot read of the mutable column, so a post-build mode flip is preserved as legitimate
live/as-of divergence rather than a retroactive restamp. A new race-immunity integration case proves a tenant
row reading connected while the build threaded outside_in records outside_in with an as-of efficacy ceiling
below 100. Typecheck and build are clean; the full suite is green with zero failures (the
contention-sensitive api-server integration suite passes cleanly on a re-run after a saturated run
intermittently flaked one unrelated test); the two-sided long-dash sweep is zero (the source guard plus
a fresh database-wide cast over all 46 public tables; AP writes no schema and no data); zero new npm
dependencies. The architect returned PASS after the threaded fix closed the race by construction. AP adds NO
new still-live drift item and documents the sovereign seat and the as-of data-source regime invariant in
`replit.md`; its only logged boundary is that the in-boundary seat runs live only when a `LOCAL_MODEL_*`
endpoint is configured (available, not connected by default).

Earlier, updated after Phase AO (priority connectors, the first phase of the Robustness and Magic wave, the
post-AN follow-on wave AO through AS that reopens the build to harden it and sharpen its surface). Phase AO
realises six of the catalogue's previously declared-only connectors as zero-SDK HTTP runtimes against the
uniform connector contract, each running in the in-client edge agent and reducing a provider's API to only
its declared catalogue signals: salesforce and hubspot (crm-sales), quickbooks-online (accounting-erp),
google-analytics-4 (marketing-web-analytics), shopify (commerce-pos-inventory), and zendesk
(support-customer). A shared `httpJson.ts` substrate funnels every provider call through one timeout,
throttle, and error discipline over the Node global fetch (no SDK, no new dependency), throwing a typed
ConnectorThrottleError on a 429 that the runtime owns the retry of and never logging a response body. The six
are registered in `IMPLEMENTED_CONNECTORS` and flipped to `implemented: true`; the rest of the catalogue and
the two warehouse connectors are untouched. The honesty boundary is carried through: a figure is omitted (a
dash, never a zero or an understated partial sum) whenever its population is incompletely observed, including
the partial-observability class where a paged walk is truncated at its record cap; the derive-and-discard
guard rejects any draft whose key the connector did not declare, and no opportunity id, contact email,
customer name, channel label, product title, or realm id ever reaches a signal. Typecheck and build are
clean; the full suite is green at 1167 tests (connectors 29 to 63, the new `priorityConnectors` suite adding
34); the two-sided long-dash sweep is zero (the source guard green and a fresh database-wide row-cast over
all 46 public tables reporting zero); zero new npm dependencies. The architect returned PASS after closing
two honesty findings: a QuickBooks aged-receivables figure that did not propagate incompleteness from a
wholly malformed nested section, and a HubSpot and Shopify population total that could be shown over a
truncated, partial sample. Phase AO's one logged drift is the connector test-harness boundary: the six
runtimes are proven against a node:http harness mirroring each provider's response shape, not against the
live third-party API, which needs real OAuth credentials and is exercised only on a real tenant connection.

Earlier, updated after Phase AN (the final verification and the consolidated report, the closing milestone of
Stage 6 and of the whole Elevated Intelligence V2 build, run under the same owner authorization that cleared
the AJ milestone pause to execute the AK-AL-AM-AN sequence linearly). Phase AN builds NO product feature and
changes no product code; it re-ran the full verification fresh and appended the consolidated report that
closes the build. The configured workflows were re-run in the protocol order (typecheck and build never
concurrent with tests): typecheck and build clean, the full suite green at 1034 tests with zero failures, the
long-dash sweep zero on both sides (the source guard over all authored source including the AN Markdown, and
a fresh database-wide cast over all 183 public text and jsonb columns across the 44 base tables), and zero
new npm dependencies across the whole build. Each named final-stage invariant is pinned by a test that turns
red when broken (the Brier maths and the downward-only confidence calibration, efficacy movement with honest
outside-in-versus-connected ceilings, decision and audit tamper-proofness over the hash-chained provenance
ledger, as-of replay reconstructing from append-only snapshot state only, and the diligence pack rendering
modelled-versus-verified honestly and flagging a broken chain). The consolidated report records the scoring
design, the efficacy index weights, the decision and forecast schemas, and the honest-labelling rules that
run through the system. The architect returned PASS with no remediation rounds and no blockers. Phase AN adds
NO new still-live drift item: the open drift at the close is exactly the set already logged below (the
source-reviewed read routes and portal surfaces of several phases, each with the service and the render
behind it tested). The whole build was COMPLETE at this point: Stages 1 through 6, Phases A through AN, all
gated and verified; there was no next phase until the Robustness and Magic wave (AO onward) reopened the
build.

Earlier, updated after Phase AM (the as-of replay and the diligence pack, the third phase of Stage 6, run under
the same owner authorization that cleared the AJ milestone pause to execute the AK-AL-AM-AN sequence
linearly). Phase AM gives the platform a memory and a way to hand it to an outsider: an as-of replay that
reconstructs what the system believed on a past date, layer by layer, with the confidence and data efficacy
it had earned by then and a diff of what has changed since, and a diligence pack that assembles a tenant's
whole evidentiary record into one self-contained, brand-styled HTML document. One new table
(`tenant_layer_snapshots`; the base-table count moves 43 to 44), an APPEND-ONLY per-build snapshot written
ATOMICALLY with the in-place `tenant_layers` upsert and capturing the build-time content, `contentHash`, data
mode, feeds, and connected-signal metadata; the efficacy index is deliberately NOT stored but recomputed at
read time from the snapshot's own inputs so it can never drift. `buildTenantAsOf` reads only append-only,
timestamped state (the latest snapshot at or before the date, the efficacy recomputed from the snapshot's
captured mode, feeds, claims, and signal metadata, the confidence recomputed from the forecasts resolved by
then), so a later refresh that delete-replaces the live `derived_signals` cannot rewrite a past connected
build, a layer with no build by then is honestly unavailable, and every diff delta is null rather than zero
when a side is absent. The diligence pack is a PURE render of data assembled from the same services the live
surfaces use, carrying the honesty boundary through to the page (verified beside modelled, the efficacy mode
ceiling, the overruled verdict, and a provenance banner that flags a broken chain rather than asserting
integrity) and escaping every tenant-controlled string; both surfaces are read-only and edit no history. Full
suite green at 1034 tests; long-dash sweep zero on both sides over all 183 public text and jsonb columns
across the 44 base tables; zero new npm deps. The architect returned PASS after two remediation rounds, the
final closing a connected-signal supersession blocker (the as-of efficacy now reads the build-time signal
metadata captured on the snapshot, not the delete-replaced live signals, with a regression proving a
post-as-of refresh cannot erase a past build's coverage or freshness). The two new still-live items (the
source-reviewed pack data assembly and as-of and diligence routes, and the source-reviewed portal as-of and
diligence surfaces including the untested `replayApi` client) are added below.

Earlier, updated after Phase AL (the decision ledger and pre-mortem, the second phase of Stage 6, run under the
same owner authorization that cleared the AJ milestone pause to execute the AK-AL-AM-AN sequence linearly).
Where Phase AK measured how good the DATA feeding a layer is, Phase AL records what a board DECIDES against
the intelligence and grades those decisions over time. Three new tables (`decision_records`, `pre_mortems`,
`pre_mortem_indicators`; the base-table count moves 40 to 43). The decision ledger holds one hash-chained
row per commit, defer, or reject, snapshotting the system recommendation and its confidence and basis at
that moment (`recommendationHash` binds the row to the exact recommendation), the provenance refs grounding
the layer at decision time (`evidenceRefs`, references into the append-only ledger, never raw evidence),
whether that snapshot was read server-side or came from the client (`recommendationVerified`), the rationale
(hashed into the provenance digest, never raw), the linked AJ forecast, and `contradictsRecommendation`. A
decision is a recorded human act, so it ALWAYS appends exactly one provenance entry. The on-demand
pre-mortem is a REAL Confounder cortex call with an honest completed-or-failed lifecycle (a completed run
writes the ranked failure modes, the residual-risk note, one provenance entry, and one watched indicator per
mode; a failed run writes an honest failed row with no provenance and no indicators), and the indicators
feed the Phase Z `premortem_indicator` push rule. The board-grade audit timeline derives the running
realised value (a cumulative sum of only terminal graded measurements, a pending decision carrying the prior
forward) and "overruled and right" (a contradicting decision is right when its forecast resolves FALSE)
entirely at read time from persisted state. Two architect-flagged gaps were closed before PASS: the
decision now snapshots the provenance evidence the recommendation rested on (bound into its provenance
digest), and the commit route reads the recommendation server-side by `actionRef` before any write (the 404
and 422 guards) and marks a no-ref commit honestly unverified. Full suite green at 1005 tests; long-dash
sweep zero on both sides over all 169 public text and jsonb columns across the 43 base tables; zero new npm
deps. The two new still-live items (the source-reviewed real pre-mortem call and the source-reviewed portal
decision surfaces) are added below.

Earlier, updated after Phase AK (the Data Efficacy Index, the opening phase of Stage 6, the final stage, run
under the owner authorization that cleared the AJ milestone pause to execute the AK-AL-AM-AN sequence
linearly). Phase AK answers a question the confidence band does not: confidence is how sure the reasoning
is, efficacy is how good the DATA feeding a layer is. A per-layer, per-tenant 0-to-100 Data Efficacy Index
is computed entirely at READ time from already-persisted state, with NO schema change (the base-table count
stays 40), mirroring the Phase O `connectionHealth` derive-on-read pattern so the index can never drift
from the data it describes. The score is a weighted average of five named drivers in one documented,
env-overridable config (coverage 0.25, freshness 0.15, verification rate 0.25, adversarial survival 0.15,
source diversity 0.20, summing to 1.0 and renormalized, each overridable by `EFFICACY_WEIGHT_*`, with a
freshness half-life and max-age floor, a diversity target, and a `feedAliasMap` bridging feed labels to
connector families so the coverage denominator is honest). The pure math marks a null driver `not_measured`
(shown as a dash, accruing disclosed unknown weight, never a zero), enforces the outside-in ceiling IN THE
MATH (the connector-grounded coverage and freshness drivers are mode-capped to zero contribution in
`outside_in` so the score can never exceed `round((1 - coverageWeight - freshnessWeight) * 100)` while
connected reaches 100, so a stray connected signal can never lift an outside-in layer past it), names the
single highest-lift cheapest improvement, and means the per-layer scores into a rollup or returns null for
an empty set. The read-time service stores nothing (a pure `buildLayerEfficacy` wires the database reads
into the math; `loadLayerEfficacy`, `loadTenantEfficacy`, and `loadEfficacyForTenants` run the queries),
the layer-detail route returns the index beside the confidence band, `GET /api/tenants/:id/efficacy`
returns the tenant rollup, and `portfolioMath` adds an efficacy rank (best-fuelled leads, null sorts last)
as a second ordering on the value-ranked board; the portal adds a framework-free `efficacyApi` client and
the LayerPage rollup and per-layer note, the Board Pack summary, and the Portfolio column, each with
distinct honest states and a dash, never a fabricated zero, for a not-measured figure. Typecheck and build
green; full suite green at 956 tests (api-server 549, portal 246, cortex 110, connectors 29, edge-agent 10,
db 8, scripts 4; +33 from AJ: api-server `efficacyMath` 19 and `efficacyService` 7 plus one `portfolioMath`
case, portal `efficacyApi` 6); long-dash sweep zero on both sides over all 150 public text and jsonb
columns across the 40 base tables (no schema added); zero new npm dependencies. The architect
`evaluate_task` returned PASS after one remediation round (the outside-in ceiling enforced in both the math
and the service, the portal honest states and dash-not-zero, and the weight env-override tests). The two
new still-live items (the source-reviewed read-time loaders and efficacy routes, and the source-reviewed
portal efficacy surfaces) are added below. Phase AK is not a milestone; the build advances to Phase AL (the
decision ledger and pre-mortem).

Earlier, updated after Phase AJ (the Brier-scored calibration ledger, a MILESTONE hard stop that supersedes
Phase W's loose hits-over-resolved calibration with a proper probabilistic scoring rule). The real
Evaluator seat now states a likelihood for each binary, resolvable claim it makes; one new `forecasts`
table (the only schema change, taking the base-table count from 39 to 40) stores that probability once
at seed time across five forecast kinds (`action_outcome`, `risk_occurrence`, `anomaly_materiality`,
`finding_survival`, `confounder_verdict`), and the honesty boundary is the column nullability: the Brier
score, outcome, resolved-at, and resolution basis stay null until the claim actually resolves. The pure
Brier math (`(p - o)^2`, a fixed 0.25 always-0.5 baseline, an empty-set null mean, a ten-band
calibration curve with null empty bands, an honest thin-sample label, and a downward-only,
threshold-gated, never-inflating confidence calibration) is hand-pinned by unit tests. A forecast
resolves exactly two honest ways: automatically from a TERMINAL outcome measurement on the committed
action it was linked to by an EXPLICIT id-or-anchor reference (never a title match, realized to 1 and
missed to 0, with the basis carried from the measurement), or by an owner adjudication whose Brier score
is computed server-side under an unresolved-row guard that prevents a double-resolve. The
`/api/calibration` route is tenant-scoped for any seat that can reach the tenant and owner-only
system-wide, and surfaces the headline Brier against the baseline, the curve, the per-layer, per-kind,
and per-seat breakdowns with sample labels, the resolved and open counts, and the resolved ledger with
misses always included; the portal `CalibrationPage` renders it with distinct loading, empty, error, and
ready states and a dash, never a fabricated zero, for a missing figure. Typecheck and build green; full
suite green at 923 tests (api-server 522, portal 240, cortex 110, connectors 29, edge-agent 10, db 8,
scripts 4; +35 from AI: api-server `brierMath` 20 and `calibration.integration` 9, portal
`calibrationApi` 6); long-dash sweep zero on both sides over all 150 public text and jsonb columns
across the 40 base tables; zero new npm dependencies. The architect `evaluate_task` returned PASS. The
two new still-live items (the source-reviewed Evaluator forecast-probability prompt and the
source-reviewed portal calibration page) are added below. Phase AJ is a MILESTONE hard stop: the build
PAUSES at the AJ gate for owner review and does NOT auto-advance to Phase AK.

Earlier, updated after Phase AI (verification and the build-report append, the closing phase and milestone of
Stage 5, Platform completion, and the end of the owner-authorized AE-through-AI sequence). Phase AI builds
no product code: it maps every Stage 5 acceptance criterion to the existing tested evidence, re-runs the
gates fresh (typecheck and build green, the full suite green at 888 tests, the long-dash sweep zero on
both sides over all 144 public text and jsonb columns across the 39 base tables), and consolidates the
Stage 5 build-report append, mirroring how Phase M closed Stage 2, Phase V closed Stage 3, and Phase AC
closed Stage 4. The last feature phase it follows, AH (cloud portability, run under the same
owner-authorized AE-through-AI sequence whose only milestone hard stop is Phase AI), makes the deployment
portable off this single managed host without changing one product guarantee: it
adds a second cloud target for each "available, not connected" seam, proves the queue is safe across more
than one instance, and writes the deploy artifacts. One shared zero-dependency AWS SigV4 signer
(`lib/aws/sigv4.ts`, `node:crypto` only) is pinned by AWS's published IAM ListUsers vector plus per-rule
canonicalization properties (single-encode for s3, double-encode for other services, sorted query, sorted
and trimmed signed headers, payload sha256). An AWS Secrets Manager adapter mirrors the Phase Q GCP one
(available-not-connected until a region is set, the SAME `[A-Za-z0-9_-]{1,255}` ref grammar so a reference
is byte-identical across providers, the full surface over the signer and fetch, ResourceNotFoundException
to null, no value or token or body logged, `SECRET_STORE_PROVIDER=aws`), and an S3 archive adapter mirrors
the Phase U GCS one (available-not-connected until `S3_ARCHIVE_BUCKET` is set, put/get/list/describe with
a non-secret describe, write-once via `If-None-Match: *` returning 412, `ARCHIVE_STORE_PROVIDER=s3`). A
new integration test proves the `pipeline_jobs` queue claims every job exactly once across two
simultaneous instances with terminal rows equal to input, documenting that `LAYER_CONCURRENCY` is
per-instance and fleet parallelism is instances times that with no fleet-wide ceiling claimed. The deploy
artifacts (a multi-stage `Dockerfile` that serves the built portal and the API as one process, a
local-parity `docker-compose.yml`, `infra/gcp/*.tf`, and `docs/migration-runbook.md`) are written and
ASCII-verified but NOT built here, because this container has no Docker daemon. The global gates were
re-run fresh: typecheck and build green, the full suite green at 888 tests (api-server 493, portal 234,
cortex 110, connectors 29, edge-agent 10, db 8, scripts 4; +35 from AG, all in api-server), and the
long-dash sweep zero on both sides over all 144 public text and jsonb columns across 39 base tables (no
schema added). Zero new npm dependencies. The architect `evaluate_task` returned PASS after one remediation round (the first review caught the GCP Terraform missing a Cloud Run `roles/run.invoker` grant, so the service URL would have been unreachable; a gated public-invoker binding to `allUsers` plus the access-model documentation were added and the gates re-run green before PASS). The new still-live
items (the per-instance LAYER_CONCURRENCY operational fact and the Docker and live-cloud owner-rerun
boundary) are added below. Phase AI, the final phase of Stage 5, then mapped every Stage 5 acceptance
criterion to existing tested evidence and re-ran the gates green; its architect `evaluate_task` returned
PASS. Phase AI now CLOSES Stage 5 and PAUSES at the milestone for owner review; it does not auto-advance.

An owner-requested complete drift report (2026-06-16) followed the Phase AI milestone hard stop as a
functional and end-to-end VERIFICATION pass, not a new phase: it drove the real application in a browser
via the Playwright testing skill across the unauthenticated surfaces (the sign-in gate, the honest
invalid-login state, and the public `/d/:token` share rendering an honest unavailable state outside the
AuthProvider), an authenticated provider-owner smoke (real login through the form, the boot splash, the
brief and layers, and the owner-only Admin, Security, and Spend consoles), and the role and tenant
fences (a provider-member gets the honest NotFound on owner-only `/admin`, `/security`, `/spend` while
the provider-allowed `/connections` renders; a client-admin gets NotFound on owner-only and
provider-only routes, `/onboarding` renders, and tenant fencing holds with `/api/tenants` listing only
the bound tenant, a 403 on an unbound tenant's overview, and 200 on the bound one). Because the owner
secrets and SESSION_SECRET reach only the workflow processes, each flow seeded a dev `users` row with a
self-generated scrypt hash, logged in through the real form, and was deleted after, leaving the shared
dev database at baseline; forging a session cookie or minting a PIN is impossible from the test runtime
and is recorded as a standing environmental fact. The gates were re-run green (typecheck, build, and the
full suite unchanged at 888) and the two-sided long-dash sweep is zero (the source guard in the suite
plus a fresh database-wide sweep over 144 text and jsonb columns across 37 base tables, of 39 total). No
defect was found and no product code changed; the full record is `docs/drift/audit-post-AI.md`. This
verification advances no gate and mints no phase; Phase AI remains the milestone hard stop.

Earlier, updated after Phase AG (the curated custom-layer creation flow, the fourth phase of Stage 5,
Platform completion, run under the owner-authorized AE-through-AI sequence; Phase AF paused at its own
gate on the real-endpoint blocker and the owner authorized proceeding). Phase AG turns the always-latent
"custom layers are more rows" capability of the `layers` registry (the single source of layer identity,
no `LAYER_KEYS` constant anywhere) into an owner-gated flow. A new `runnableLayerCondition()` predicate
(canonical OR `approvedAt` set) is the SINGLE gate consulted by BOTH `orchestrator.loadRegistry` (the seed
fan-out) and `GET /layers` (the portal catalog), so an unapproved custom layer is withheld identically
from per-tenant output and the catalog and the two can never disagree. The `layers` table gains an
approval gate (`approvedAt`, `approvedBy`) and an optional `benchmarkCanonicalKey` self-reference (no new
table). An owner creates a custom layer from a `.strict()` guarded template (exactly four metric tiles, an
archetype the hero registry can render, at least one feed) that cannot smuggle `isCanonical`,
`approvedAt`, or `sortOrder`, with honest valid-but-empty defaults and `deepStripDashes` at the new text
sink; it persists UNAPPROVED and runs nowhere until the owner approves it (owner-only, idempotent, records
`approvedBy`). A benchmark mapping must reference an existing canonical layer, and the cohort recompute
excludes an unmapped custom layer and pools a mapped one UNDER its canonical key, so cohort membership is
never fabricated. `ALLOWED_ARCHETYPES` (api-server) and the portal hero `REGISTRY` keys (`ARCHETYPE_KEYS`)
are kept in lockstep by a source-reading guard test (no shared package), currently nine renderable
archetypes. The portal Access console gains an owner-only "layers" tab (`CustomLayerPanel`) with distinct
honest loading, empty, and error states. The global gates were re-run fresh: typecheck and build green,
the full suite green at 853 tests (api-server 458, portal 234, cortex 110, connectors 29, edge-agent 10,
db 8, scripts 4; +34 from AF, in api-server and portal), and the long-dash sweep zero on both sides over
all 144 public text and jsonb columns across 39 base tables (one text column added,
`benchmarkCanonicalKey`; no table added). Zero new npm dependencies. The architect `evaluate_task`
returned PASS on the first pass with no findings. The new still-live item (the source-reviewed portal
panel) is added below. Per the owner-authorized sequence Phase AG does NOT pause at its own gate; execution
continues to Phase AH. The next protocol milestone hard stop is Phase AI at the end of Stage 5.

Earlier, updated after Phase AF (the local LLM seat and sovereign-mode phase, the third phase of Stage 5,
Platform completion, run under the owner-authorized AE-through-AI sequence). Phase AF adds one local
OpenAI-compatible seat and a single sovereign data mode that runs EVERY cortex stage in-boundary. Config
gains a "sovereign" `CortexDataMode` resolved by a single `resolveCortexDataMode(env)` switch
(`CORTEX_DATA_MODE=sovereign`) and a `runsOnLocal(stage, dataMode)` predicate (`sovereign ||
runsInBoundary`); `IN_BOUNDARY_STAGES` and the outside_in and connected behaviour are byte-for-byte
unchanged, and the no-literal-model invariant holds (the local model id stays a SEAT, never inlined). In
sovereign mode the orchestrator routes every stage through the local `ExtractionZoneRuntime` seam on one
threaded `StageContext`; confound and challenge still RUN but on the local seat with grounding DROPPED
(honest, no faked Google Search), and `seedTenant` uses a pure no-fetch homepage context so even the
profile stays in-boundary. Sovereign-only telemetry markers (`executionMode:"sovereign"`,
`groundingAvailable:false`, `webSearchAvailable:false`) are recorded only from a real run, a narrate and
score verified-to-modelled calibration is applied before persistence, and a sovereign run that emits
`verified_claims` fails loud rather than presenting a faked verification channel. The portal
`ReasoningStrip` shows "Reasoned in sovereign mode" and "External grounding unavailable" only when a
stage telemetry is sovereign, with real model and token figures only. Proven HERMETICALLY (no live model)
by an in-process conformance server and spies: connected makes zero frontier calls from the extraction
zone, and sovereign makes zero external Anthropic/Gemini calls anywhere, every stage on the injected
local runtime with confound/challenge not skipped. The global gates were re-run fresh: typecheck and
build green, the full suite green at 819 tests (api-server 433, portal 225, cortex 110, connectors 29,
edge-agent 10, db 8, scripts 4; +25 from AE, all in cortex and api-server), and the long-dash sweep zero
on both sides over all 143 public text and jsonb columns across 39 base tables (no schema added). Zero
new npm dependencies. The architect `evaluate_task` returned PASS after two remediation rounds at the
sovereign orchestration boundary (keep the express reduction off in sovereign mode, label the generator
from telemetry not config, and thread plus actually apply a pre-persist calibrate; then replace the
sovereign homepage fetch with the no-fetch context and carry the real model id and sovereign markers
through the folded enrichment telemetry). Per the real-endpoint blocker Phase AF PAUSES at its own gate:
this container has no local OpenAI-compatible model endpoint (`LOCAL_MODEL_*` unset, nothing listening,
no GPU), so `docs/drift/STOP.md` records what is proven hermetically versus what needs a real endpoint
(real extraction quality and a local-only full seed with real latency and token/cost telemetry, plus the
owner rerun steps), and the build does NOT auto-advance to Phase AG without an owner. The new still-live
item is added below. The next protocol milestone hard stop is Phase AI at the end of Stage 5.

Earlier, updated after Phase AE (the ingestion suite, the second phase of Stage 5, Platform completion,
run under the owner-authorized AE-through-AI sequence). Phase AE adds five inbound data paths that all
terminate at ONE shared derive-and-discard core, so no path can persist a raw artifact: the core parses
the inbound bytes or payload in memory, derives a `DerivedSignalSet`, persists ONLY the derived math
through the Phase H connector terminus (`persistDerivedSignalSet`, per-tenant encrypted and set
root-hashed), guards every signal's key, window, and unit as a non-identifying metric token at this
terminus, appends one provenance entry per layer whose claim path records the ingestion method and layer
(the source ref is the derived-set root hash over the math only), and discards the raw input. The paths are the ingestion API `POST /v1/ingest` (per-tenant scrypt-hashed revocable key
in `ingestion_keys`, equal-time miss path, rate limited, OpenAPI document), per-source webhooks
(timing-safe HMAC against a secret in `webhook_sources`), manual upload (csv and xlsx deterministic math;
pdf and docx contract text extracted in the in-boundary seat and discarded, leaving numeric metrics;
spreadsheet signals keyed by generic positional `column_<n>` so a raw header never lands in a stored key;
strict MIME, extension, and size gating; honest derived-versus-discarded account), an SFTP drop
(per-tenant credential, inbound-directory watcher, delete whether processed OR rejected so no raw file
lingers, quiet-period guard), and an MCP
server (`submit_signals` plus `get_diagnosis`, `get_layer`, `get_actions` under per-tenant auth), with a
portal Access-console panel to mint and revoke keys and webhook sources with a one-shot reveal. The
central acceptance is test-proven: one integration test drives all five paths with a single unique
sentinel and sweeps every public text and jsonb column plus the SFTP scratch directory, asserting it
appears nowhere. The global gates were re-run fresh: typecheck and build green, the full suite green at
794 tests (api-server 429, portal 225, cortex 89, connectors 29, edge-agent 10, db 8, scripts 4; +36 all
in six new api-server files), and the long-dash sweep zero on both sides over all 143 public text and
jsonb columns across 39 base tables. Zero new npm dependencies. Two shared test-infrastructure faults
surfaced by the sixth DB-touching integration file were fixed (the SFTP quiet-period age clamp, and
serializing the cross-package test runner plus a test-time `lib/db` pool cap; the server pool default is
unchanged); the one accepted LOW is the source-reviewed portal ingestion admin client (added to "Still
live" below). The architect's first review returned FAIL with four boundary-hardening items at the
derive-and-discard seam (the ingestion metadata-token guard, generic positional upload keys, SFTP
discard of a rejected file rather than a `.rejected` copy, and a strengthened raw-absence test); all four
were applied and the gate re-run green before the architect `evaluate_task` returned PASS. Per the owner-authorized sequence this phase
does NOT pause at its own gate; execution continues to Phase AF, whose acceptance needs a real local
OpenAI-compatible model endpoint absent from this container, so a STOP.md and pause follow at the AF gate
if none is provided. The next protocol milestone hard stop is Phase AI at the end of Stage 5.

Earlier, updated after Phase AD (the full-application experience audit, the opening phase of Stage 5,
Platform completion, run as a single owner-authorized phase). Per the binding Adaptation Guide, Phase
AD was RETIRED AS AN OVERHAUL and run instead as a SHORT audit of the existing portal against the
design language (`docs/design-language.md`) and the AD acceptance set, FIXING DRIFT rather than
redesigning. Phase AD is presentation-only: it changed CSS, shared page-chrome classes, and text-color
token USAGE, and it reconciled the design-language doc to the implementation; it added no product
feature and changed no route, schema, contract, or product logic, added and changed no test, and added
zero npm dependencies, so the full suite stays at 758 tests unchanged. Two of the seven acceptance
items carried real drift, both fixed at the SHARED level because inline styles outrank classes on
specificity: the CRITICAL 375px usability drift (new `.page-width`, `.top-nav-row`, `.top-nav-bar`, and
`.table-scroll` classes plus an `@media (max-width: 480px)` block, the three core read pages wrapping
wide tables in `.table-scroll`, desktop visually equivalent) and the WCAG AA contrast drift (a tone-INK
mapping routes every normal-sized under-24px tone text off the base brand hues to ink shades that clear
4.5:1 on paper, cream, and faint fills, with base hue kept only for large figures, strokes, borders,
icons, fills, dots, and dark surfaces, plus a global navy-soft `:focus-visible` ring). The other five
needed no code fix: two-click diagnosis and sub-five-minute first insight confirmed by source review,
distinct loading/empty/error states audited across every async surface through the shared `DataState`
with no fabricated data, the design-language doc reconciled in three places with no unstyled default
component found, and the regression contract held by the unchanged green suite. The global gates were
re-run fresh: typecheck and build green, the full suite green at 758 tests, and the long-dash sweep zero
on both sides over all 138 public text and jsonb columns across 37 tables. The architect `evaluate_task`
returned PASS after two remediation rounds. The accepted LOWs are the source-reviewed 375px proof and
the operator and admin tables outside the core-read scope not being retrofitted (both added to "Still
live" below). Phase AD opens Stage 5; per the owner authorization for this single phase the build now
PAUSES at the AD gate for owner review before Phase AE and does not auto-advance, and the next protocol
milestone hard stop is Phase AI at the end of Stage 5.

Earlier, updated after Phase AC (verification and the build-report append, the closing phase of Stage 4,
Differentiation and Moat, run back to back with Y, Z, AA, and AB under owner authorization). Phase AC
built no product feature and changed no product code; like Phase M closed Stage 2 and Phase V closed
Stage 3, its only artifacts are the Stage 4 evidence matrix (`phase-AC.md`), the build-report append, and
these drift updates. Each Stage 4 acceptance criterion is mapped to existing tested evidence with the
proof type marked honestly. Test-proven by the integration suite against live Postgres or by
deterministic unit tests: the portfolio ranked board and the access fence with a 403 outside the
portfolio, the push ranking and low-impact suppression and the exactly-once Morning Brief drain and the
access-revoked event failed in place, the challenge finding-version helpers and the route boundary, the
benchmark k-anonymity and identity-free recompute, the share-token one-way hash and clamp and status,
the public projection that strips every internal field in the type and at runtime, the redaction
chokepoint that keeps a bearer share token out of the observability path, the k-anonymized case-study
aggregation, and the deterministic voice measurement that never edits the prose. Honestly marked
source-reviewed rather than test-proven (the one accepted LOW): the `runFindingChallenge` re-reason
engine (it spends real model calls the suite does not run) and the share-token mint and resolve and the
unauthenticated public diagnosis route (no dedicated route integration test); the helpers, route
boundary, and portal clients around them ARE tested. The global gates were re-run fresh: typecheck and build green,
the full suite green at 758 tests, and the long-dash sweep zero on both sides over all 138 public text
and jsonb columns across 37 tables. Zero new npm dependencies. Two boundaries are honestly not live (the
external push sinks and the durable secret and archive backends are available-not-connected unless
configured; the realized-value and benchmark figures were produced by earlier real runs and recomputed,
not by a fresh paid seed). The architect `evaluate_task` returned PASS. Phase AC closes Stage 4; per the
owner-authorized Y-Z-AA-AB-AC run the build now PAUSES at the Stage 4/5 boundary for owner review before
Phase AD and does not auto-advance, and the next protocol MILESTONE hard stop is Phase AI at the end of
Stage 5.)

An owner-requested post-X audit and remediation pass (2026-06-15) followed the milestone hard stop; it
minted no phase and advanced no gate. It actioned three in-scope fixes in the benchmark cohort read path
and re-confirmed the gates and the two-sided long-dash sweep. The full record is
`docs/drift/audit-post-X.md`; the now-resolved benchmark re-gate item has moved from "Still live" to
"One-time or resolved" below.

An owner-requested post-AN remediation pass (2026-06-17) followed the Phase AN closing milestone; it
minted no phase and advanced no gate. It resolved every "Still live, worth attention" item that could be
closed in code under the hard constraints (the shared config-gated rate-limit store, the ledger
database-role append-only hardening, the cortex write-path injected-model tests, the public, efficacy, and
as-of and diligence read-route integration tests, the portal pure-logic extraction and its unit tests, and
a live 375px measured pass that caught and fixed a real overflow), re-confirmed the gates and the two-sided
long-dash sweep, and left the genuinely deferred items in place with their reasons. The resolved items have
moved from "Still live" to "One-time or resolved" below; the single residual of true DOM-rendering tests is
consolidated into one bullet that remains in "Still live". The full record is `docs/drift/audit-post-AN.md`.

## Phase verdicts

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | Pass | yes (passed) |
| D | Auth, Orgs and Access | Pass | no |
| E | Product Surfaces | Pass | no |
| F | Fast Seeding and World-Class Seed Data | Pass | no |
| G | Parity Gate and Core Build Report | Pass | yes (paused for owner review) |
| H | Connector Framework and Registry | Pass | yes (paused for owner review) |
| I | Connected Mode, Edge Agent, and Runtime No-Write Guard | Pass | yes (paused for owner review) |
| J | Split Pipeline (Tier 2, the Lens In-Boundary) | Pass | no (gated, paused for owner confirmation) |
| K | Tier 3: Cryptographic Isolation, No Standing Access, Hash-Chained Provenance | Pass | yes (paused for owner review) |
| L | Connected Portal Security Surfaces (Posture, Connections, Break-glass, Provenance) | Pass | no (gated, paused for owner review) |
| M | Stage 2 Full Verification and the Build-Report Append | Pass | no (gated, paused for owner review) |
| N | Cost and Token Observability | Pass | no (gated, paused for owner review) |
| O | Connector Operational Reality | Pass | no (gated, autonomous O-P-Q run) |
| P | Observability and Alerting | Pass | no (gated, autonomous O-P-Q run) |
| Q | Secrets Vault | Pass | no (gated, autonomous O-P-Q run; owner review after Q) |
| R | Expand Test Coverage and Confirm CI | Pass | no (gated, autonomous R-S-T run) |
| S | Retention and Deletion | Pass | no (gated, autonomous R-S-T run) |
| T | Client Onboarding Experience | Pass | yes (milestone hard-stop, paused for owner review) |
| U | Backups and Disaster Recovery | Pass | no (gated, Stage 3; autonomous U-V-W run) |
| V | Verification and the Build-Report Append (closes Stage 3) | Pass | no (gated, Stage 3; autonomous U-V-W run) |
| W | Outcome Loop and Value Realized (opens Stage 4) | Pass | no (gated, Stage 4; autonomous U-V-W run; hard stop after W before milestone X) |
| X | Benchmarking and the Data Network Effect | Pass | yes (security milestone; hard stop for owner review) |
| Y | Portfolio Intelligence View | Pass | no (gated, Stage 4; autonomous Y-Z-AA-AB-AC run, pauses before AD) |
| Z | Proactive Push Intelligence | Pass | no (gated, Stage 4; autonomous Y-Z-AA-AB-AC run, pauses before AD) |
| AA | Interactive Challenge | Pass | no (gated, Stage 4; autonomous Y-Z-AA-AB-AC run, pauses before AD) |
| AB | Sellability Pack | Pass | no (gated, Stage 4; autonomous Y-Z-AA-AB-AC run, pauses before AD) |
| AC | Verification and Build Report (closes Stage 4) | Pass | no (gated, Stage 4; autonomous Y-Z-AA-AB-AC run, pauses before AD) |
| AD | Experience Audit and Drift Fix (opens Stage 5) | Pass | no (gated, Stage 5; single owner-authorized phase, pauses at its own gate before AE) |
| AE | Ingestion Suite | Pass | no (gated, Stage 5; autonomous AE-AF-AG-AH-AI run, pauses at the AI milestone) |
| AF | Local LLM Seat and Sovereign Mode | Pass | no (gated, Stage 5; PAUSED at the AF gate on the real-endpoint blocker, does not auto-advance to AG) |
| AG | Curated Custom-Layer Creation Flow | Pass | no (gated, Stage 5; autonomous AE-AF-AG-AH-AI run, pauses at the AI milestone) |
| AH | Cloud Portability | Pass | no (gated, Stage 5; autonomous AE-AF-AG-AH-AI run, pauses at the AI milestone) |
| AI | Verification and the Build-Report Append (closes Stage 5) | Pass | yes (milestone hard stop; closes Stage 5, end of the autonomous AE-AF-AG-AH-AI run, paused for owner review) |
| AJ | The Brier-Scored Calibration Ledger | Pass | yes (milestone hard stop; supersedes Phase W loose calibration, paused for owner review) |
| AK | The Data Efficacy Index | Pass | no (gated, opens Stage 6; owner-authorized AK-AL-AM-AN sequence run linearly, advances to AL) |
| AL | The Decision Ledger and Pre-mortem | Pass | no (gated, Stage 6; owner-authorized AK-AL-AM-AN sequence run linearly, advances to AM) |
| AM | As-of Replay and the Diligence Pack | Pass | no (gated, Stage 6; owner-authorized AK-AL-AM-AN sequence run linearly, advances to AN) |
| AN | Final Verification and the Consolidated Report (closes Stage 6 and the whole build) | Pass | yes (closing milestone of Stage 6 and the whole build; owner-authorized AK-AL-AM-AN sequence complete, build closed) |
| AO | Priority Connectors (opens the Robustness and Magic wave) | Pass | no (gated; reopens the build closed at AN as the first of the AO-AS wave; advances to AP) |
| AP | Sovereign Seat Realisation (correctness audit) | Pass | no (gated, Robustness and Magic wave; advances to AQ) |
| AQ | Outcome Loop Closure | Pass | no (gated, Robustness and Magic wave; advances to AR) |
| AR | Operational Hardening | Pass | no (gated, Robustness and Magic wave; advances to AS) |

## Recurring environmental drift (accepted, not fixable in code)

- No manual git tags. Replit manages version control through automatic
  checkpoints, so `docs/drift/INDEX.md` is the progress source of truth in place of
  per-phase `phase-<id>` tags. Logged in A through F.
- Hosted CI cannot execute inside this environment. The GitHub Actions workflow's
  four steps (install, typecheck, build, test) run locally and pass, which is the
  same evidence the hosted job would produce. Introduced in B, referenced since.
- Owner secrets reach the workflow processes only, not the agent shell or sandbox,
  so live owner login is verified via the integration suite and the bootstrapped
  owner row rather than an interactive curl. Logged in D, holds since.

## Still live, worth attention

- SESSION_SECRET coupling (D). PIN code hashes and session signatures both derive
  from it, so rotating it invalidates all sessions and all outstanding PINs at
  once. Operational caveat, captured in `docs/deploy-readiness.md`.
- Scheduled loops require a single loop-runner instance (AR). The seven in-process
  scheduled loops have no cross-instance coordination, so the deployed target pins
  one always-on instance and that instance is the loop runner; a multi-instance
  request tier needs a separate single loop-runner instance or per-loop leader
  election. A deployment posture (logged at boot), not code-level coordination,
  captured in `docs/deploy-readiness.md` and `docs/go-live-checklist.md`.
- Live seed concurrency held at LAYER_CONCURRENCY=2 (F). The Anthropic integration
  rate-limits hard; above about four concurrent claimers a seed hits a 429 storm,
  and an errored layer is terminal, so the live runs were benched at 2 for zero
  429s. The default is 5; recorded timings are conservative against it. Provider
  rate limit, not a code defect.
- Express-to-full total cost exceeds a direct full seed (F). Express optimizes time
  to first ready, not total cost: express plus a later upgrade is more wall-clock
  and spend than one direct full seed. A deliberate trade, not a defect.
- Local KMS is a software key store, not an HSM (K). The default `KmsRuntime` holds
  the per-tenant key-encryption keys in operator-controlled Postgres
  (`kms_local_keys`), so the isolation and crypto-shred guarantees hold in software
  but the keys are not in dedicated key hardware. The customer-managed-key path is a
  swappable adapter that reads "available, not connected" until configured; a real
  cloud KMS or bring-your-own-key service implements the same interface with no
  envelope or call-site change. Captured here and in `phase-K.md`.
- Challenge history is treated as non-critical supplementary data on the layer and Ask Different Day
  pages (AA). If the challenge-history fetch fails, the page renders the diagnosis WITHOUT the challenge
  overlay rather than blanking the whole page on a supplementary-data outage; the main diagnosis is
  primary and the challenge overlay is additive. A deliberate honest-degradation choice, logged as
  accepted drift; a future refinement could surface a distinct "challenge history unavailable" affordance
  on the control rather than an empty overlay.
- Case studies recomputed per public diagnosis hit, not cached (AB). `loadCaseStudyForTenant` rebuilds
  the full k-anonymized case-study set on each cold-link request rather than reading a materialized
  cache. It is correct and never stale, but at scale it is a latency consideration on the public
  fast-link path; the architect noted it as non-blocking. A future refinement could cache the published
  studies with an honest freshness stamp. Accepted as logged drift until latency measurements show it
  violates the fast-link experience.
- The authenticated share-token sellability routes are source-reviewed, not behind an HTTP integration
  test (AC residual). The share-token mint, list, and resolve routes (`routes/sellability`) are
  compile-verified and source-reviewed, while the token hash, clamp, and status helpers, the public
  projection, and the route redaction ARE unit-tested and the unauthenticated public diagnosis route IS
  now integration-tested (`routes/public.integration.test.ts`). Accepted as logged drift; a future
  `routes/sellability` integration test can close it.
- Cross-package test suite is run serialized, with a test-time DB pool cap (AE). The root `test` script
  runs the per-package vitest suites at `--workspace-concurrency=1` and `lib/db` caps the per-process
  pool at 5 under `VITEST`, because the default concurrent run oversubscribed the 8 CPUs and tripped the
  pool connection-acquisition timeout as intermittent 500s in whichever DB-touching test was running.
  Product runtime is unaffected (the server pool default of 20 is unchanged; an explicit
  `DATABASE_POOL_MAX` still wins). A test-harness decision, logged so a future reader knows the suite is
  intentionally serialized.
- No real local OpenAI-compatible model endpoint in this container (AF). Sovereign mode runs every cortex
  stage in-boundary on a local seat that speaks the OpenAI-compatible `POST /v1/chat/completions` wire, but
  `LOCAL_MODEL_*` is unset, nothing is listening on a local inference port, and there is no GPU. The
  routing, the three honesty markers, the verified-to-modelled calibration, and the fail-loud
  "available, not connected" path are proven HERMETICALLY by an in-process conformance server and spies
  (no live model). What needs a real endpoint and is therefore deferred to an owner rerun: the real
  extraction quality of an actual local or open model on the sovereign path, and a local-only full seed of
  a real tenant end to end with real timings and token/cost telemetry. No figure is fabricated to stand in
  for them; per the blocker the build PAUSES at the AF gate and does not auto-advance to Phase AG. The
  provable-versus-needs-endpoint split and the owner rerun steps and missing env are in `docs/drift/STOP.md`.
- Multi-instance fan-out has no fleet-wide ceiling, by design (AH). `LAYER_CONCURRENCY` is the
  per-instance worker count, so the total parallelism across a fleet is `instances * LAYER_CONCURRENCY`.
  The `pipeline_jobs` queue (not a coordinator) is the safety boundary: an integration test proves each
  job is claimed exactly once across two simultaneous instances with terminal rows equal to input. This is
  an operational fact to size deliberately, not a defect; no global limiter is claimed.
- Cloud portability is proven by adapter, not by a live container or cloud (AH). The AWS SigV4 signer, the
  AWS Secrets Manager and S3 adapters, the multi-instance queue proof, and the single-process
  portal-plus-API serving are test-proven through the workflows, but four things are the owner's to run and
  are NOT done here (claiming them would be fabrication): `docker build` and `docker compose up` (no Docker
  daemon in this container), a full in-container demo seed (needs a Docker host plus live model provider
  keys, and a live frontier seed is deliberately not re-run for cost), a live AWS or GCP run of the
  available-not-connected adapters (needs real credentials and a bucket the owner provisions), and
  `terraform apply` of `infra/gcp` plus the durable Postgres and PITR the platform owns. The
  provable-versus-owner-rerun split is in `phase-AH.md`.
- True DOM-rendering tests for the portal surfaces remain deferred under the zero-new-dependency rule
  (Y, AE, AF, AG, AJ, AK, AL, AM). After the post-AN remediation (2026-06-17), the portal data clients and
  the extracted state, format, and derivation logic behind every one of these surfaces ARE unit-tested as
  framework-free modules (the portfolio board and its `portfolioApi`, the ingestion and custom-layer admin
  panels, the sovereign reasoning strip, the calibration page, the efficacy surfaces, the decision surfaces,
  and the as-of and diligence surfaces with their `replayApi` client), and the server routes behind them ARE
  integration-tested. What remains uncovered is ONLY the JSX component rendering itself, because jsdom and a
  testing-library would be new dependencies held off under the zero-new-dependency rule. Accepted as logged
  drift; a future pass that adopts a DOM test harness can close it. See `docs/drift/audit-post-AN.md`.

## Live but runtime-only or cosmetic

- Provider rate limits (C, F). Free-tier Anthropic and Gemini return frequent 429
  under fan-out; absorbed by inner backoff and outer retry, and by the benched seed
  concurrency. Surfaces only during a seed; no failure is masked as success.
- Schema tolerance over rejection at model-output boundaries (C, F). Grounded model
  output is coerced and sliced rather than rejected; semantic enums are never
  coerced at the storage boundary. Known cosmetic limit: a thousand-separated
  sparkline value such as 1,200 reads as 1. Extended in F: the score-stage claim
  `basis` coerces an unknown or missing value to the conservative `modelled` at the
  stage input boundary, while the stored content schema stays strict.

## One-time or resolved

- Auth and connector rate limiting now have a shared, config-gated store (D and O, resolved in the post-AN
  remediation 2026-06-17). The auth fixed-window limiter and the connector token buckets were per process
  and reset on restart, so neither held across more than one instance. A single `RATE_LIMIT_STORE` seam
  (default `memory`, unchanged) now also offers `postgres`, which routes both through shared `rate_limit_*`
  tables so the limit and the quota hold across a fleet; a two-instance test proves two simulated processes
  share one window and one bucket, and the stored key is a one-way HMAC of the client identifier (no raw IP
  or email persisted). The in-memory default stays the single-VM target. See `docs/drift/audit-post-AN.md`.
- Provenance ledger append-only is now enforceable at the database role (K, M, resolved in the post-AN
  remediation 2026-06-17). `infra/sql/provenance-ledger-append-only.sql` grants a restricted role SELECT and
  INSERT only, revokes UPDATE, DELETE, and TRUNCATE on `provenance_ledger`, and verifies the posture with a
  `has_table_privilege` block that raises loudly on any write privilege, including one inherited through a
  group or `PUBLIC`. The hash chain and serialized append remain the runtime control and `verifyChain` is
  unchanged; the revoke is a documented deploy-time artifact the single-role dev DB cannot demonstrate. See
  `docs/drift/audit-post-AN.md`.
- The cortex write paths are now covered by injected-model tests (AC, AJ, AL, resolved in the post-AN
  remediation 2026-06-17). `runFindingChallenge`, the Evaluator forecast path, and `runDecisionPreMortem`
  took an optional runtime override (default unchanged, resolve from env), and new injected-fake-model tests
  drive the challenge re-reason, the Evaluator forecast persistence, and the pre-mortem end to end with no
  billed model call, closing the "proven by source inspection only" gap on those paths. See
  `docs/drift/audit-post-AN.md`.
- The public, efficacy, and as-of and diligence read routes now have integration tests (AC, AK, AM, resolved
  in the post-AN remediation 2026-06-17). New HTTP integration tests cover the unauthenticated public
  diagnosis route, the efficacy read routes, and the as-of and diligence-pack read routes against live
  Postgres. The authenticated share-token sellability routes remain source-reviewed, tracked as the one AC
  residual in "Still live, worth attention". See `docs/drift/audit-post-AN.md`.
- The portal surface logic is now unit-tested as framework-free modules (Y, AE, AF, AG, AJ, AK, AL, AM logic
  portions, resolved in the post-AN remediation 2026-06-17). The remaining state, format, and derivation
  logic was extracted into framework-free modules and unit-tested, and the `portfolioApi`, `ingestionApi`,
  and `replayApi` clients gained unit tests. Only the JSX DOM rendering remains deferred under the
  zero-new-dependency rule, consolidated into the single "Still live" bullet above. See
  `docs/drift/audit-post-AN.md`.
- The 375px core-read usability is now a live measured pass (AD, resolved in the post-AN remediation
  2026-06-17). A live 375px Playwright viewport pass first measured real horizontal overflow on the
  core-read surfaces (document `scrollWidth` up to 444 vs an `innerWidth` of 375), contradicting the prior
  source-only assumption; the fix was made at the shared-chrome level plus a `.table-scroll` wrapper on the
  operator and admin tables, and a re-measurement found all six surfaces (Morning Brief, a layer page, Board
  Pack, Portfolio, Spend, Admin) at 375/375 with no horizontal page overflow. See
  `docs/drift/audit-post-AN.md`.
- Benchmark cohort read now re-gates stale stats against the current k floor (X, resolved in the
  post-X audit 2026-06-15). The Phase X non-blocking caveat was that `buildLayerCohort` trusted the
  most recent `benchmark_stats` rows without re-filtering them against the CURRENT `BENCHMARK_MIN_COHORT`,
  so a stat computed under a looser floor could be served until the next recompute superseded it.
  Resolved: the read now computes the current floor, keeps only stats whose `sampleCount` meets it,
  unlocks only on the surviving stats, and otherwise falls through to the existing honest lock that
  counts live opted-in peers. A new integration test inserts a sample-of-7 stat, asserts it unlocks at
  the default floor 5, then raises the floor to 8 and asserts it re-gates to a lock at `unlocksAt = 8`.
  The read is now at least as conservative as the recompute. See `docs/drift/audit-post-X.md`.
- Portal had zero automated tests (B). Deferred from B with `--passWithNoTests`.
  Closed after Phase D: the portal data layer is unit tested across both surfaces
  (auth and the Access console), with a mocked fetch covering every status-to-error
  and 401 branch. Only DOM-rendering component tests remain deferred, because jsdom
  and a testing-library would be new dependencies held off under the
  zero-new-dependency rule.
- Cross-tenant breadth deferred from Phase E to Phase F (E). Phase E built the
  portal against the one seeded tenant and deferred multi-tenant breadth to F.
  Resolved in F: four real tenants are seeded to ready with verifiably distinct
  figures.
- Score-stage basis fragility (F). The Evaluator occasionally emitted a claim basis
  outside {verified, modelled}; the in-call retry self-corrected it every time
  (zero seed failures). Resolved in the F remediation: the score-stage basis
  coerces unknown or missing values to `modelled` at the input boundary and the
  prompt states the allowed values, while stored content stays strict.
- Anchor-sweep "any shared figure fails" premise (F). The first sweep failed on any
  shared currency figure, which is empirically wrong for independent real
  companies. Resolved in F: the sweep fails on a real templating signature (a pair
  sharing two-plus specific figures or over 30 percent of its anchors, or a
  specific figure broadcast to three-plus tenants), and the pass/fail logic is
  extracted into a unit-tested pure module.
- Long dashes in persisted generated data, especially the run table (G). A source-
  only em-dash guard cannot see model-generated text that lands in the database. The
  Phase G gate sweep found long dashes in 39 `tenant_pipeline_runs` rows (the raw
  per-stage outputs persisted by the orchestrator) while every other table was
  clean. Resolved in G: the deterministic sanitizer now runs at every jsonb persist
  boundary (the tenant profile, the `tenant_layers` row, and the run sub-stage and
  error writes), the cleanup script and the database-wide sweep cover the run table
  and `pipeline_jobs`, the 39 rows were cleaned to zero, and the source guard was
  strengthened to catch the en-dash as well as the em-dash.
- Empty V2 import and V1 reference URL from the owner (A). The V2 target repo
  imported empty and the V1 reference URL was supplied by the owner in chat.
  Recorded in memory for re-clone; resolved.
- Model API keys deferred (A). Deferred to the Phase C boundary and wired there;
  exercised live by the Phase C seed and the four Phase F live seeds. Resolved.

## Logged spec deviations (decisions)

- Share token stored as a one-way hash only, plaintext returned once (AB). The opaque token is 32
  bytes of CSPRNG entropy base64url; only its sha256 hash is persisted and the plaintext is returned
  to the minter exactly once, so a database read can never reconstruct a working link and a lost link
  is re-minted, never recovered. The same one-way-reference posture the SecretStore and KMS seams take.
- Public projection enforced in the type and at runtime (AB). `PublicDiagnosisLayer` is an `Omit` of
  the internal owner persona, diagnostic question, and layer feed graph, and `toPublicDiagnosisLayer`
  strips them at runtime, so the unauthenticated surface cannot leak an internal field by accident at
  either layer.
- Case studies reuse the Phase X privacy machinery wholesale (AB). A case study gates on the same
  `getBenchmarkMinCohort` k-anonymity floor and blurs with the same `applyNoise` bounded noise as the
  benchmarks, and uses the same `computeOutcomeSummary` as the outcome counter, so social proof can
  never disagree with the counter and a small cohort can never be deanonymized.
- Single redaction chokepoint for secret-bearing URL path segments (AB). `redactRoute` collapses a
  bearer-carrying path (today `/api/public/diagnosis/<token>`) to its route template before the error
  handler attaches the path to the observability context, so a token in a URL can never reach an
  external sink. Any future secret-in-URL route must add its pattern here, not invent a second seam.
- Push rules are per-user, not per-org (Z). A `push_rules` row belongs to exactly one user
  (`ownerUserId` NOT NULL), so the notification center, read-state, mute, and threshold tuning
  are all per-seat and one user muting a kind never silences another user's signal. The cost is
  a default rule per (user, tenant, kind); the benefit is an honest per-seat surface.
- One channel per push rule, snapshotted onto the event (Z). A rule has a single `channel`,
  copied to the event at creation so a later channel change never rewrites delivered history.
  Multi-channel fan-out per rule is a later additive change, not built this phase.
- A single global Morning Brief cadence, not per-rule schedules (Z). The evaluation and drain
  run on one platform cadence (`PUSH_MORNING_BRIEF_INTERVAL_MS`); the evaluation exposes
  optional `restrictToUserIds` / `restrictToTenantIds` seams so a test or a future per-user
  trigger can confine a pass hermetically without per-rule scheduling.
- `failed` reused for access-revoked push events, no separate `revoked` status (Z). A pending
  event whose (owner, tenant) binding was revoked is failed in place (visible in the center,
  never delivered), keeping the lifecycle to four honest states and avoiding an enum migration.
- scrypt instead of bcrypt or argon2 (D). The spec authorised bcrypt or argon2, but
  both ship native addons that are fragile under the Nix toolchain. scrypt is a
  strong, memory-hard KDF in the standard library, so it keeps the
  zero-new-dependency rule. The stored hash is self-describing, so the cost can be
  raised later without breaking existing rows.
- Zod v4 via the `zod/v4` subpath of zod 3.25.x (B). The chosen contract layer.
- `GET /api/tenants` list, access-fenced (E). A deliberate reversal of Phase D's
  no-list stance, scoped by the access fence, so the portal can offer a tenant
  picker without exposing tenants across the fence.
- Postgres-backed `pipeline_jobs` queue brought forward from Phase AH (F). A new,
  separate, generic table so AH and the connector work can extend it later without
  reshaping seed state.
- Patagonia and Hillman are the same scale (F). They genuinely share a $1.47
  billion reported-revenue figure; the anchor sweep surfaces it as a documented
  real-world coincidence (a single-pair warning, below the broadcast threshold),
  not templating.
- Anchor-sweep templating-signature definition (F). What counts as a failure is a
  pair sharing two-plus specific figures or over 30 percent of its currency
  anchors, or a specific figure broadcast to three-plus tenants; round figures and
  percentages stay benign.
- Long-dash sanitization at the persist boundary (G). The prompts ask the models to
  avoid the long dash, but the guarantee is a deterministic pass (`deepStripDashes`)
  on every jsonb sink the orchestrator writes: em-dash to spaced ASCII hyphen,
  en-dash to plain ASCII hyphen, numbers and identifiers untouched. Deliberate
  typography canonicalization, not semantic change.
- Parity verified at the code and component level (G). The Core Master Prompt's words
  are to run V1 and the new system side by side; the verification done is a
  component-by-component inventory against the frozen `reference/v1` source plus the
  full automated suite and the Phase E side-by-side acceptance, not a live two-
  instance dual-deploy. Stated honestly in `docs/build-report-core.md`.
- Three V1 extras not carried (G). The company picker and library mode, the coachmark
  tour, and the signal ticker are outside the named reference-surface set and the
  Phase B through F acceptance items, so they are a scope decision, available later.
- New internal workspace package `lib/connectors` (H). The connector framework is a
  workspace package rather than a folder in api-server, mirroring lib/cortex and
  lib/db, so the contract is importable by the api-server and a future in-client
  agent without dragging in the server. Zero new npm deps; pg and @types/pg were
  already in the lockfile.
- Connector path imports `@workspace/db/contracts` only, never the db root (H).
  Importing the db root opens the application Postgres pool as a side effect; the
  contracts subpath keeps the connector path free of any handle to our store so it
  can run inside the in-client edge agent. Enforced by a static import-boundary test.
- Two warehouse reference connectors implemented, 44 declared (H). The spec's full
  "at least two per family run end to end" is the end-state acceptance for the later
  connector phases; the Phase H order asks for the two bring-your-own-warehouse
  reference connectors, done, with the rest declared and rendered as available, not
  connected. Postgres stands in for the client warehouse in the end-to-end test
  (Redshift speaks the Postgres wire and generic-sql targets any Postgres-wire
  warehouse); Snowflake, BigQuery, and Databricks stay declared because their
  drivers would be new dependencies. The connectors table stores the catalogue
  surface only; the registry-only `path` and `implemented` fields are not columns.
- New `edge_agents` table beyond the Part 4 Tier 1 minimum schema (I). The
  per-tenant agent credential lives in its own table (a scrypt hash of the secret
  plus an active or revoked status) rather than on `tenants` or in `tenant_keys`, so
  a revoke is a single-row update and the credential never mixes with key material.
  An addition, not a rename.
- Agent bearer is the API trust root, mTLS terminates at a proxy (I). The server
  reloads the credential row on every agent call for immediate revoke and never
  trusts a proxy-injected client-certificate header; mutual TLS protects the channel
  at the proxy while the bearer authorizes the request at the application. Proven
  over a loopback client-certificate handshake (a no-certificate client is rejected).
- Edge-agent base URL enforced HTTPS by default (I). Plain http is allowed only for
  a loopback host or an explicit `EI_AGENT_INSECURE_HTTP=1` test opt-out, so the
  bearer is never sent in clear by misconfiguration. Applied as the architect's
  non-blocking security note and covered by a config test.
- Connected grounding appended only on the connected path (I). Both data modes run
  one shared `runLayers` helper and outside-in passes no grounding, so the
  outside-in prompts are byte-for-byte unchanged while connected mode grounds on
  `derived_signals` only.
- Runtime no-write guard is a tripwire, not a sandbox (I). ESM `node:fs` bindings are
  read-only and cannot be patched, so the runtime guard catches require-based ambient
  writes only; the primary guarantee is the static import-boundary test that forbids
  `node:fs` (and the db root) in connector and edge-agent source. The process-global
  patch window could in principle trip a concurrent legitimate CommonJS filesystem
  write during a long extraction, but no such live write path exists, so it is
  recorded, not active. Edge connectors are declared not implemented; the runner is
  proven with an injected stub over real mutual TLS, not faked telemetry.
- The Lens is the in-boundary set; the Synthesist and adversarial seats stay external
  (J). In connected mode only perceive and hypothesise run in-boundary on the local
  seat, because the Lens is where the client's own signals are first interpreted; the
  later external seats operate on the already-derived Lens output and the math-only
  grounding, never raw client content, so they can stay on the stronger external
  models. The split is a no-op in outside_in mode.
- Fail loud, never a silent external fallback (J, the architect's Option C). A
  connected run with no local seat configured returns "available, not connected"
  rather than quietly sending the sensitive stages to an external provider. Honesty
  over availability; the operator must configure the boundary model deliberately.
- The local model identifier is read from env, not a source literal (J). Keeps the
  existing no-literal-model-string invariant intact and `SEATS` at the three external
  seats, while letting the operator pick any self-hosted model at deploy time via
  `LOCAL_MODEL_BASE_URL`, `LOCAL_MODEL_MODEL`, and an optional `LOCAL_MODEL_API_KEY`.
- One narrow seam (`ExtractionZoneRuntime`) for every in-boundary call, the TEE not
  built (J). The cortex never knows whether the call is a plain HTTP adapter or a
  future attested TEE runner, which is what lets the TEE drop in later with no stage
  or orchestrator change. The in-boundary guarantee this phase is deployment-
  topological (the model runs on operator-controlled infrastructure), not yet
  cryptographically attested; the local endpoint is a trusted deployment target, and
  the adapter never logs an upstream error body and never exposes the api key through
  the seam.

- Envelope stored inside `derived_signals.value` jsonb, no new column (K). Each signal
  value becomes `{v,alg,keyRef,iv,tag,ct,wrappedDek}` in the existing jsonb rather than
  adding ciphertext columns, so the connected persist and read paths change but the
  table shape does not; the derived-set root hash is still computed over the plaintext
  math, not the ciphertext.
- One per-tenant KEK, no global HKDF (K). The local KMS holds a distinct random 32-byte
  key-encryption key per tenant rather than deriving per-tenant keys from one master,
  because crypto-shred must destroy exactly one tenant's ability to decrypt and nothing
  else; a shared master with per-tenant derivation could not be shredded per tenant.
- No standing access, break-glass for every role including owners (K). Reading raw
  signal values requires tenant access plus an active, unexpired, unrevoked grant even
  for an owner, and every access appends an `access_grant_events` row; the in-boundary
  machine-grounding read is a separate service API that is exempt by design, never a
  middleware bypass of the human guard.
- Reads fail loud, never silent empty grounding (K). A revoked or missing key, a
  legacy-plaintext row, or an absent or expired grant raises a typed error
  (`crypto_shredded`, `break_glass_required`, and the encryption error types) rather
  than returning an empty result that would read as "no data"; the orchestrator records
  a loud layer failure instead of grounding on nothing.
- Phase M is verification and reporting only (M). The connector and SOC 2 stage (H
  through L) was verified against Part 8 with no product code change; item 2 is recorded
  as partial (the catalogue is complete at 46 connectors across ten families, but only
  the warehouse family runs two connectors end to end) and item 9 as met-with-residual
  (application-layer append-only plus the hash chain plus the UI verify, with
  database-role write blocking deferred to deployment), and the connected-refresh time
  was measured on the real warehouse path, not a stub or an invented number.
- Phase V is verification and reporting only (V). Stage 3 (Operations and Hardening, N through U) was
  verified against the twelve points of section 9 with no product code change; every point is met or
  honestly accounted for, and the integration-versus-live boundaries (live paid seeds in C and F, the
  injected OAuth-refresh seam, the available-not-connected external sinks and cloud backends, and the
  operator-level full PITR restore) are marked in the matrix rather than overclaimed as live runs.
- Cost priced by seat, never by a model literal (N). The Phase N pricing module resolves
  a reported model string back to one of the three cortex seats through `SEATS` and prices
  from `SEAT_RATES`, so the no-model-literal config invariant is preserved; a self-hosted
  or unrecognised model takes the zero rate because it incurs no external per-token charge.
- Pricing rates are published list prices, not the operator's contract (N). The seat rates
  (reasoner 3 in / 15 out, evaluator 1 in / 5 out, grounder 1.25 in / 10 out per MTok,
  web search 0.01 per call) are documented verify-before-trust defaults in the pricing
  module and the console; negotiated or volume pricing will differ. An honest default, not
  a measurement.
- The `billed` telemetry flag is the no-fabrication gate (N). A `model_usage` row is
  written only when a real token-billed response occurred (`billed && model`); a no-call
  failure (no in-boundary model, a provider with no env, a transport failure before any
  response) carries `billed: false` and writes nothing, and a billed-but-failed call is
  recorded at its real cost. Tokens are summed across the two-attempt corrective retry so a
  billed-then-retried attempt counts once, never dropped or doubled.
- Usage tapped only in the orchestrator, the sole side-effect owner (N). One row per real
  call from three taps (the stage run on the ok and error path, the enrichment as one row
  not the batched folded peers, and the profile build after the tenant is ensured); resume
  paths return before the tap so a resumed run records no duplicate. Cost tracking is
  best-effort relative to the diagnosis: a ledger-write failure is logged and swallowed
  rather than aborting a layer, so it can under-count but never break a seed.
- Budget caps env-backed, enforced twice (N). `SPEND_GLOBAL_MONTHLY_CAP_USD` (default
  1000), `SPEND_TENANT_MONTHLY_CAP_USD` (default 50), and `SPEND_ALERT_THRESHOLD` (default
  0.8) drive a governor that reads the real summed ledger spend, refuses a new seed at a
  ceiling and warns at the threshold, enforced both in the seed and refresh routes (typed
  HTTP error) and defensively in the seed path; the owner-only `priorityOverride` bypasses
  the global ceiling only, never the per-tenant ceiling.
- Token-scoped erasure deliberately unsupported for aggregate signals (S). The Operations
  prompt's S allows a token-scoped delete "within a tenant where identity threads exist", but
  derived signals are aggregate math with no identity thread, so a `tokenRef` erasure is
  rejected with `token_erasure_not_supported_for_aggregate_signals` before any delete rather
  than silently widened to a full tenant erasure. A future per-identity store would add a real
  token-scoped path; this seam refuses honestly rather than overloading.
- Erasure appends a ledger redaction, never trims the ledger (S). A tenant erasure deletes
  the derived signals but preserves the append-only provenance ledger by appending a
  `redaction:derived_signals:tenant` entry with a `sha256:<digest>` over the erased ids and
  provenance refs, in the same transaction as the delete, so `verifyChain` keeps passing. The
  new `appendEntryTx` export composes the append inside the caller's transaction and adds no
  update or delete path. The `retention_events.redactionLedgerEntryId` is a plain uuid pointer,
  not a foreign key, so the audit and the ledger stay independent.
- Client-viewer is a strictly read-only seat (T). The plan's read list was diagnosis plus
  reasoning plus provenance; the applied and architect-endorsed default extends it with an
  explicit write refusal, so a client-viewer is 403 on both action mutation routes (it reads the
  war room and track record but cannot commit a move or advance an action) and on the
  break-glass raw-signal read. Provider seats and the client-admin (on their own bound tenant)
  remain the writers, and the portal hides any control a viewer would be refused. A separate
  client action-writer role is the future path if customer governance ever needs one.
- Client-admin self-serve onboarding is scope-forced, never scope-trusting (T). The new
  `/api/client` router lets a client-admin mint, list, and revoke client-viewer PINs only; the
  scope is forced server-side to the caller's own org and the `client-viewer` role, and a
  `scopeOrgId` or `scopeRole` in the body exists only so a widening attempt is rejected loudly
  (`scope_org_forbidden`, `scope_role_forbidden`) rather than silently overridden. A shared
  `mintInvitePin` helper backs both this route and the owner admin route so they cannot drift.
- Restore drill restores into a scratch SCHEMA, not a separate instance (U). The crown-jewel
  restore proves a logical export round-trips and the ledger chain survives, into an isolated
  `scratch_restore_*` schema in the same database (no FKs or indexes, always dropped). This is the
  strongest restore proof the application can make on its own; a full PITR-to-new-instance drill
  is the operator's platform-level procedure, documented in `docs/backup-and-dr-runbook.md`. Like
  Phase Q's durable-secret boundary, durable Postgres storage and PITR are a platform
  responsibility the application documents rather than reimplements.
- Skip-unchanged archive guard is not globally serialised across processes (U, LOW, accepted).
  The scheduled archive loop runs from one entrypoint and never overlaps itself, so only a manual
  trigger racing the scheduled tick could duplicate. Because each object key embeds a compact
  timestamp plus a `sha256` prefix, a concurrent duplicate writes a DIFFERENT, content-identical
  key under write-once protection plus a second honest, content-identical audit row, so integrity
  is never compromised, only a redundant object and row can appear. A database advisory lock or a
  unique-digest constraint would be an operational refinement, logged here rather than built.
- No business-performance hero surface in V2 (W). The value counter and the calibration badge elevate
  the existing Track Record (the actions page) rather than minting a new hero, satisfying the "elevate,
  do not replace" instruction directly instead of inventing a surface the V1 reference did not have.
- Calibration kept loose, not Brier-scored (W). The accuracy is hits over resolved (realized or
  missed), returning a null score on an empty record rather than a fabricated 100 percent. This is
  intentional: milestone AJ supersedes it with a Brier-scored ledger, so W only has to be honest.
- predictedValueUsd derived from a currency-anchored impact only (W). A dollar prediction is parsed
  only when anchored by a `$` or `USD` token; a percentage, a margin-point figure, or prose yields
  null. The baseline is snapshotted only from a single real scalar derived signal in connected mode,
  null otherwise. The platform never coerces a non-currency figure into an invented dollar value.
- basis=measured requires a real signal; status=missed only on a final measurement (W). A measurement
  is `measured` only when a real finite scalar derived signal backs it; a missing or non-scalar signal
  is a loud `400 signal_not_found`, never a silent downgrade to `modelled`. `missed` is set only on a
  final measurement, so an in-flight action below its prediction reads `on_track`, never a spurious miss.
- Benchmark tables hold no raw data and no tenant identity (X). `benchmark_cohorts` and
  `benchmark_stats` have no tenant column and carry only counts and percentiles, so a cohort is a
  population and a stat is a distribution, never a roster or a list of the numbers behind it. The
  recompute audit `benchmark_events` is identity-free; the ONLY tenant-scoped audit path in the feature
  is `benchmark_consent_events`. This is the defining privacy guarantee of the milestone, enforced
  structurally rather than by policy.
- k-anonymity floor plus disclosed bounded noise (X). A cohort below `BENCHMARK_MIN_COHORT` (default 5)
  publishes no stat, so a distribution can never be reconstructed from a cohort too small to hide an
  individual; a cohort in `[k, noiseBand)` (`BENCHMARK_NOISE_BAND`, default 20) is published with
  bounded noise tied to a fraction of the IQR, clamped to preserve `p25 <= p50 <= p75`, flagged
  `noised` and surfaced as "privacy protected". A labelled privacy control over a real distribution,
  never an invented number.
- Machine grounding read, skip-and-count on unreadable (X). The recompute reads each opted-in tenant's
  decrypted scalar signals through the MACHINE grounding read extracted from the orchestrator path, not
  the break-glass human read; a revoked or missing key is caught per tenant, skipped, and counted in
  `skipped_tenant_count`, so one crypto-shredded tenant never fails the whole run or corrupts a cohort.
- Modelled peer benchmark kept alongside the verified cohort, never replaced (X). The two bases are
  visually and structurally distinct (a "Verified cohort" pill versus the modelled tiles), so a
  modelled estimate is never presented as a verified cohort fact. Consent is default off and the
  client-viewer seat is read-only on it (server 403, the UI hides the control without relying on that
  for authorization).

## No faked output, any phase

Phase AC added no faked output and no faked telemetry: it is verification and documentation only and built
nothing and changed no product code, like Phase M closed Stage 2 and Phase V closed Stage 3. It cited the
existing in-phase evidence rather than re-running a destructive or paid check, marked each proof type
honestly (integration against live Postgres, a deterministic unit test, an available-not-connected
adapter, or source inspection where a write path spends real model calls or lacks a route integration
test), and re-ran the global gates fresh and reported their real current totals (758 tests, the
two-sided long-dash sweep zero over 138 public text and jsonb columns across 37 tables). No total was
rounded and no check was reported green without running it. Phase AB below holds, and the earlier phases
under it.

Phase AB added no faked output and no faked telemetry. The selling surface is built to expose less, never to
invent more. A share token's plaintext is shown exactly once and never persisted (only its sha256 hash is
stored), so a database read cannot reconstruct a working link, and an invalid, expired, or revoked token
returns a uniform 404 that reveals nothing. The public diagnosis projection strips the internal owner
persona, the diagnostic question, and the layer feed graph in the type AND at runtime, and exposes no raw
connector data and no provenance; a case study is published only above the k-anonymity floor, blurred and
flagged when the cohort is small, and carries no tenant id, name, url, or date, computed by the same
`computeOutcomeSummary` the outcome counter uses so it can never disagree with it. The access telemetry
(view count, last-accessed) is recorded only on a genuine resolve. The editorial voice evaluator MEASURES
and reports, it never rewrites a character, so a below-bar narrative is shown at its real band rather than
silently corrected; rewriting prose to pass would be fabricating output, and it is deliberately not done.
No test was made to pass by weakening an assertion; the 758-test suite and the two-sided long-dash sweep
are reported at their real current totals. Phase AA below holds, and the earlier phases under it.

Phase AA added no faked output and no faked telemetry. Every challenge verdict is computed by the
Confounder and Synthesist seats from the real finding and the user's objection, or it is an honest
failure: a model call that returns nothing usable, or a `revised` verdict with no new confidence, is
recorded as a `failed` row with the real billed telemetry and NO outcome and NO provenance entry, never a
fabricated uphold or an invented confidence number. The recorded telemetry is the real billed usage of
each seat. A revise re-bases the challenge row's basis to `modelled_user_informed` and never rewrites the
stored finding, so the user can object but can never delete or silently overwrite a finding; a completed
challenge appends exactly one hash-chained provenance entry over source references with the user text
hashed in, so the audit chain still verifies. The history's `isCurrentVersion` flag is computed by
comparing the stored finding hash to the live finding, so a challenge against a since-changed finding is
shown as addressing a prior version rather than misrepresented as current. No test was made to pass by
weakening an assertion; the 716-test suite and the two-sided long-dash sweep are reported at their real
current totals. Phase Z below holds, and the earlier phases under it.

Phase Z added no faked output and no faked telemetry. Every push event figure is computed from persisted
state or it is null: `impactUsd` comes from a parsed dollar prediction or a real measured shortfall,
`confidence` from the action, and `rankScore` is `impactUsd * confidence / 100`, zero when unquantified, so
an event with no dollar figure ranks last and is suppressed, never promoted, and a null impact renders as an
empty bracket in the digest rather than a fabricated `$0`. A breach is recorded once per state (idempotent
by `(ruleId, dedupeKey)`), so re-evaluation never invents a duplicate; a mute records suppressed events
rather than dropping them, so no high-signal record is lost. The access fence holds on both the mint and the
deliver path, so a push event is never minted for, or delivered about, a tenant the recipient can no longer
reach. The available-not-connected slack and email sinks fail loudly when unconfigured rather than
pretending to send. No test was made to pass by weakening an assertion; the 685-test suite and the two-sided
long-dash sweep are reported at their real current totals. Phase Y below holds, and the earlier phases under
it.

Phase Y added no faked output and no faked telemetry. Every portfolio figure is computed from persisted
state or it is not shown: a company with no currency-anchored prediction or no measurement carries null
dollar figures, which `formatUsd` renders as a dash, never a fabricated `$0` or an invented "value at
risk", and the totals expose how many companies actually have layer content and outcomes behind the
numbers. A cross-portfolio gap pattern appears only for a gap shared by at least two tenants, so a gap
unique to one company is never promoted into a fabricated trend. The scope is the session binding, so the
board never shows a tenant the caller is not entitled to, and an empty binding set is an honest empty
board rather than a borrowed or fabricated one. No test was made to pass by weakening an assertion. The
646-test suite and the two-sided long-dash sweep are reported at their real current totals. Phase X below
holds, and the earlier phases under it.

Phase X added no faked output and no faked telemetry. A benchmark figure is computed from persisted,
de-identified cohort math or it is not shown: a cohort below the k-anonymity floor publishes no stat and
the requesting tenant sees an honest lock, never a fabricated distribution, and the bounded noise on a
small-but-eligible cohort is a disclosed privacy control over a real distribution (flagged `noised`,
clamped to preserve `p25 <= p50 <= p75`), never an invented number. The published benchmark tables hold
no raw values and no tenant references at all, so no peer identity or peer value can leak; the live read
positions only the requester's OWN figure against the de-identified cohort. An unreadable tenant is
skipped and counted rather than silently dropped or guessed, the modelled peer benchmark is kept visibly
separate from the verified cohort so neither is mistaken for the other, and the consent toggle reflects
the persisted state and flips only after the server confirms. No test was made to pass by weakening an
assertion. The 627-test suite and the two-sided long-dash sweep are reported at their real current
totals. Phase W below holds, and the earlier phases under it.

Phase W added no faked output and no faked telemetry. Every figure the value counter and the calibration
badge show is computed in the pure `outcomeMath` module from already-persisted numbers, so the summary
reconciles against a direct database sum, the latest measurement per action is used so a re-measured
action is never double-counted, and an empty record returns a null calibration score rather than a
fabricated 100 percent. A measurement is `basis=measured` only when a real finite scalar derived signal
backs it; a missing or non-scalar signal is a loud `400` rather than a silent modelled estimate, and a
predicted dollar value is parsed only from a currency-anchored impact, never invented from a percentage
or prose. The 593-test suite and the two-sided long-dash sweep are reported at their real current
totals. Phase V below holds, and the earlier phases under it.

Phase V added no faked output and no faked telemetry: it is verification and documentation only and
changed no product code. The evidence matrix cites only checks that actually run, and where a check
could not be run live it is marked as such rather than claimed as a live result (the live paid model
seeds were Phases C and F, the OAuth refresh is proven against an injected seam, the external sinks and
the durable cloud backends are available-not-connected, and the full PITR restore is operator-level).
No test was made to pass by weakening an assertion, and no invariant test was broken to "demonstrate"
it; the existing in-phase red-on-break proofs are cited instead. The 557-test suite and the two-sided
long-dash sweep are reported at their real current totals. Phase U below holds, and the earlier phases
under it.

Phase U added no faked output and no faked telemetry, and where a real managed backend is not
connected it ships an honest adapter rather than a fake. The GCS archive adapter constructs
without validating anything and, with no `GCS_ARCHIVE_BUCKET`, the first call throws a precise
"available, not connected" error rather than fabricating a write; the local-fs default makes the
archive and restore cycle genuinely provable. The status route reports only the real provider and
its connected state, never a bucket, path, or credential. A skipped archive (empty or unchanged
ledger) writes no object and no audit row, so a reader never sees an archive that did not happen,
and the digest is over the content-only canonical bytes so an unchanged ledger is genuinely
skipped rather than re-written under a new timestamp. The restore drill verifies the per-table
counts and re-walks the chain from the RESTORED scratch rows, so a green result is earned by real
round-tripped data, and the scratch schema is always dropped even on failure. The crown-jewel
bundle and the ledger archive carry only ciphertext, one-way hashes, and references, never a
secret value. No test was made to pass by weakening an assertion; the global restore-drill test
deliberately does not assert a global `chainVerified === true` because a concurrent test file
intentionally tampers its own ledger rows, so the deterministic restored-row proof is the
owned-sub-chain read instead. Phase T below holds, and the earlier phases under it.

Phase T added no faked output and no faked telemetry. The onboarding surface shows only
persisted invite rows, and a one-time PIN code is shown once at mint and never stored or
re-fetched (only its HMAC hash is persisted), so the UI never displays a code it cannot prove it
just generated; the loading, empty, ready, and error states are distinct. The UI gating mirrors
the server gate rather than hiding a still-open capability: a client-viewer is refused at the
server on the action routes and the break-glass read, and the portal simply does not offer those
controls. No test was made to pass by weakening an assertion; the positive action-write tests
were moved to a genuinely authorized actor (a bound client-admin) rather than relaxing the gate.
Phase S below holds, and the earlier phases under it.

Phase S added no faked output and no faked telemetry. Every retention figure is computed from
persisted state: the `deletedDerivedSignalCount` is the real number of rows the delete
returned, never an estimate, and a TTL tick that purges nothing writes no audit row rather
than a zero-count row, so a reader never sees a purge that did not happen. The erasure records
a `sha256` digest over the erased ids and provenance refs as evidence, not the erased values,
and appends it to the ledger rather than trimming the ledger, so `verifyChain` keeps passing
on real chain data. Token-scoped erasure is refused honestly with a typed error rather than
silently widened. No test was made to pass by weakening an assertion; the ledger surface test
was widened to admit the new append-only helper while still asserting no update or delete
export. Phase R below holds, and the earlier phases under it.

Phase R added no faked output and no faked telemetry: it added test coverage and changed no
product code. The prompt-hygiene detector reports only what it actually finds, a digit welded
to a unit, and never flags a bare number, so it neither invents a violation nor masks one;
the guard scans the real prompt sources and was green on them without any source being
altered to pass, and the breakage is demonstrated through synthetic strings in the test, not
by committing a bad prompt. No invariant test was made to pass by weakening the assertion.
Phase Q below holds, and the earlier phases under it.

Phase Q added no faked output and no faked telemetry, and where a real managed backend is not
connected it ships an honest adapter rather than a fake. The GCP Secret Manager adapter
constructs without validating anything and, with no `GCP_PROJECT_ID`, the first resolution
throws a precise "available, not connected" error rather than returning an empty value or
crashing the boot; with a project and token configured it performs real REST calls. The
default env-backed store resolves secrets from the platform-injected environment, the
legitimate durable home, and never invents a value. `EnvSecretStore.set`/`.delete` mutate the
in-process environment only and say so (honest by design, not a silent durable write). The
acceptance is proven, not asserted: a unique sentinel resolved through an injected store
during a real refresh is swept for across every public text and jsonb column and the
repo-root `.replit`, and the count is zero. Phase P below holds, and the earlier phases under
it.

Phase P added no faked output and no faked telemetry, and where a real external sink is not
connected it ships an honest adapter rather than a fake. With no `SENTRY_DSN` the error
reporter is a no-op ("available, not connected") and `captureError` invents no envelope;
with no Slack or webhook env the notifier delivers to the log sink and never fabricates an
alert (it only ever delivers a row an emitter actually recorded, claimed exactly once with
`FOR UPDATE SKIP LOCKED`). The Operations route reads real run, queue, and alert tables with
no synthesized metric, and the health route reports each dependency honestly: the database
and secret store are really probed, the model providers report `configured` or
`not_configured` from env and escalate to a live check only on an explicit deep probe, and a
dependency that cannot be probed reads `unknown`, never a fabricated `ok`. Phase O below
holds, and the earlier phases under it.

Phase O added no faked output and no faked telemetry, and where a real runtime does not yet
exist it ships an honest seam rather than a fake. There is no oauth2 connector runtime, so
the default token refresher rejects with "available, not connected" and the scheduler is
proven with an injected refresher; the failed-renewal path (error, re-authentication
required, critical alert) is fully real. No connector honestly supports incremental
extraction (the warehouse runtimes compute whole-table aggregates), so every descriptor
keeps `incremental.supported = false` and the watermark plumbing stays dormant in
production; the cursor seam is real and tested by temporarily enabling support on a
descriptor, and any returned cursor is dropped on the full-derive path. Connector health is
derived from real last-success and last-error timestamps at read time, never stored, so it
cannot drift from reality, and a connection that has never run reads as degraded rather than
healthy. The rate limiter retries only a typed throttle signal and never a genuine error,
and an alert fires only on the transition into error, never on a steady-state failure.
Phase N below holds, and the earlier phases under it.

Phase N added no faked output and no faked telemetry: this is its defining constraint. The
`model_usage` ledger holds a row only because a real provider call billed real tokens; the
dollar figure is those real token counts at configured list-price rates (verify-before-
trust defaults, stated as such), rounded to the ledger's six decimals, with a missing count
treated as zero and never guessed. The `billed` flag is the gate: a call that made no
request carries `billed: false` and writes nothing, so the ledger never contains a
fabricated zero-cost line, and a 200 that billed tokens then failed our own validation is
still recorded at the real cost. The corrective retry sums its billed attempts so a token
count is never dropped or doubled. The Spend console renders only what the ledger holds,
with honest loading, empty, error, and unauthorized states, and the summary reconciles to a
direct `SUM` over the table. The budget governor decides on the real summed spend, not an
estimate. Phase M below holds, and the earlier phases under it.

Phase M added no faked output and no faked telemetry: it built nothing and changed no
product code. It verified the stage and recorded an honest result, marking item 2
partial (the catalogue is complete and honest at 46 connectors across ten families, but
only the warehouse family runs two connectors end to end) and item 9 met-with-residual
(application-layer append-only plus the hash chain plus the UI verify, with
database-role write blocking still a deployment-time hardening), and the
connected-refresh latency was measured on the real warehouse path (median 60.9 ms on
local Postgres-wire), not a stub or an invented number. Phase L below holds, and the
earlier phases under it.

Phase L added no faked output and no faked telemetry. The portal security surfaces
render only real backend facts: the customer-managed KMS is shown as "available, not
connected" exactly as the backend reports it, every fetch error is a distinct state
from an empty result, the three Tier 3 refusals (break-glass required, crypto-
shredded, unreadable) each map to their own honest notice rather than an empty list,
and the human signal read shows decrypted values exactly as the math produced them,
never cached or exported and never invented when absent. The e2e ran against a real
signed-in provider-owner over real HTTP, not a mocked shell. Phase K below holds, and
the earlier phases under it.

Phase K added no faked output and no faked telemetry. The local KMS performs real
AES-256-GCM wrap and unwrap and a real key destroy (crypto-shred is proven by a read
that returns a typed `crypto_shredded` error after revoke, not a stubbed value); the
customer-managed-key adapter reports an honest "available, not connected" until a key
is configured rather than fabricating a wrap or a status; the break-glass and
provenance surfaces are exercised end to end over real HTTP against a real Postgres,
and verifyChain is tested on both a clean and a deliberately corrupted chain. Phase J
below holds, and the earlier phases under it.

Phase J added no faked output and no faked telemetry. The in-boundary adapter is a
real HTTP client, proven against a real `node:http` server; when no local model is
configured `getExtractionRuntime` returns null and the connected Lens fails loud with
"available, not connected" (telemetry model "local: not connected") rather than
fabricating an answer or silently falling back to an external provider. The split-
routing tests use an injected runtime to assert routing, not to stand in for real
output that was required this phase, and the external seats still receive only the
profile, the Lens output, and the math-only derived-signal grounding. outside_in is
byte-for-byte unchanged. Phase I below holds, and the earlier phases under it.

Phase I added no faked telemetry: no edge connector is implemented, every edge
connector returns the honest "available, not connected" error, and the edge-agent
runner is proven with an injected stub connector over a real mutual-TLS loopback
rather than fabricated signals. Connected-mode grounding renders only the numeric
`derived_signals` (a vector as `vector[len]`), never raw client text, and a raw
`DerivedSignalSet` violation fails the run loudly in both the refresh service and the
agent ingest path. Phase H below holds, and the earlier phases under it.

Phase H added no generation and no faked output: the two warehouse reference
connectors run real aggregate SQL against a real warehouse and return computed
math, the other 44 connectors are honestly declared and return an "available, not
connected" error rather than stub data, and the catalogue's declared signal keys
are statements of capability, not measurements. The earlier phases hold as below.

Across A through G nothing is stubbed, mocked, or faked: the cortex and Confounder
run live (C) and were exercised again by four end-to-end Phase F live seeds (three
fresh tenants plus a live express-to-full upgrade), each recording real per-seat
tokens, latency, and cache figures; express mode marks reduced layers honestly
(skipped sub-stages with no model call, not invented content); the portal renders
real registry, session, and persisted layer data with explicit loading, empty, and
error states (E); and the auth suite drives the real app against live Postgres (D).
The Phase G parity gate added no generation; it inventoried the real surfaces,
completed the long-dash enforcement over persisted data, and stated the parity
method honestly rather than claiming a live dual-deploy that did not happen.
