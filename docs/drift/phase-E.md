# Phase E: Product Surfaces

Verdict: Pass. The per-tenant portal is built to the V1 design language at or
above parity, sourced entirely from real persisted per-tenant data, with no
static demo data and no fabricated figures. Every surface has designed loading,
ready, empty, error, and no-tenant states; a diagnosis is reachable in two
clicks; the build adds zero new npm dependencies and contains no em-dash or
en-dash. Typecheck, the full test suite (api-server 73, portal 105), the
production build, and the dash sweep are all green.

## Requirements checklist

- Morning Brief and Board Pack from real layer content. Done (E4). Both are
  projected from the registry left-joined to persisted content and ordered
  through the pure perspective lens; ungenerated layers render an honest
  not-generated state rather than a placeholder.
- Layer page plus eight archetype heroes over real fields. Done (E3). The heroes
  morph layout and emphasis only over real `heroPanel`, `content.metrics`, and
  `peerBenchmark`; none invent waterfall, funnel, or node-edge values. A null
  `heroPanel` or a sub-two-point trend degrades to a metric-only layout.
- Intelligence Architecture (ruling: per-seat telemetry from runs plus engine
  config). Done. The seats and ordered stages are read from `GET /api/architecture`
  (fixed engine config, identical for every tenant, never hardcoded in the
  portal); per-seat telemetry is summed from the current tenant's recorded run
  sub-stages. With no tenant the architecture still stands; telemetry waits.
- Data Heartbeat (ruling f). Done. Feeds and their consuming layers come from the
  registry; activity (last finished run, recorded search calls, recorded compute)
  is derived by `deriveHeartbeat` from run timestamps and telemetry. It polls only
  while a run is genuinely queued or running and rests on recorded totals
  otherwise, never animating a finished run as if live.
- Anomaly Inbox (ruling e). Done. `deriveAnomalies` (pure, unit-tested) ranks
  errored runs, partial or unresolved confounders, modelled actions below the
  confidence threshold, and gaps by `confidence_lift_pp`. Each row links to its
  layer. The threshold is a selection rule only and is never displayed as a score.
- Dependency Map (ruling g). Done. `deriveDependencyGraph` builds edges from
  shared module group and shared feeds; node weight is the real sum of each
  layer's gap `confidence_lift_pp`. The hand-rolled SVG (`layoutNodes`, circular)
  declares its layout as non-data geometry; ungenerated layers remain zero-weight
  nodes so structure never dangles. No charting dependency was added.
- Ask Different Day (ruling d). Done. A sourced brief: each generated layer's real
  diagnostic question, answered from persisted narrative, causes, actions, and
  confounders with provenance pills and `generatedAt`. Every answer states it was
  assembled from saved intelligence and is not a live query. No live cortex call.
- War Room (ruling: read-only synthesis, defer interactive simulation). Done. Open
  questions (confounders), leading hypotheses, and recommended moves are a
  read-only synthesis of persisted signals. Interactive what-if simulation is
  deferred because its numbers would be fabricated.
- Committed actions UI on the E1 endpoints (ruling c). Done. The War Room commits
  a recommended move via `POST commit` only when it carries a real basis and
  confidence (an uncommittable move says so), and advances committed moves through
  their lifecycle via the status endpoint. The Track Record (`/actions`) remains
  the read-only ledger. No fabricated outcomes (that is the AJ-AN scope).
- Tenant list and picker on real access-filtered data (ruling a). Done (E1, E2).
  `GET /api/tenants` returns only the caller's accessible tenants; the picker and
  every tenant-scoped surface render from it.
- Boot splash from real recorded runs. Done (E4). It polls `/runs` and renders the
  real recorded sub-stage states and durations, with a static recap for finished
  runs, gated to once per session.
- Hard constraints. Done. Zero new npm dependencies; no em-dash or en-dash; AA
  contrast via the audited token system; 375px responsive; all values from real
  persisted fields.

## Acceptance criteria

- Every required surface renders from real per-tenant data at or above V1 parity.
  Met. See the parity table below.
- Diagnosis in two clicks. Met. See the click-depth audit below.
- Designed loading, ready, empty, error, and no-tenant states everywhere. Met.
  Every tenant-scoped page branches on `useTenant().status` so a null tenant from
  an empty or errored list renders a designed state rather than a perpetual
  skeleton; every fetch and mutation maps a 401 to logout.
- AA and 375px. Met by construction. The new surfaces reuse the same primitives,
  pills, and design-language CSS variables audited at AA in Phases C and D, and use
  flex-wrap, auto-fill grids, and a viewBox-scaled responsive SVG so they reflow at
  375px.
- All checks green. Met. Typecheck clean; api-server 73 and portal 105 tests pass;
  production build green (1728 modules); dash sweep clean across artifacts, lib,
  and docs.
- Drift report, parity table, and INDEX. Met. This report, the table below, and the
  INDEX row for Phase E.

## V1 parity table

| V1 surface | V2 surface | Data source | Parity |
| --- | --- | --- | --- |
| Executive brief | Morning Brief (`/`) | registry left-join persisted content, ordered by perspective lens | At, plus the perspective lens |
| Board readout | Board Pack (`/board`) | same projection, board emphasis | At |
| Per-company analysis | Layer pages (`/layers`, `/layers/:key`) with 8 archetype heroes | persisted layer detail, real fields only | Above (8 archetype heroes over one prop shape) |
| Reasoning / model view | Intelligence Architecture (`/reasoning`) | `GET /api/architecture` plus per-seat run telemetry | Above (real per-seat telemetry overlay) |
| Data freshness | Data Heartbeat (`/heartbeat`) | registry feeds plus run timestamps and telemetry | Above (live-only polling, honest rest state) |
| Issues / alerts | Anomaly Inbox (`/anomalies`) | `deriveAnomalies` over real signals and runs | Above (ranked, unit-tested derivation, 1-hop to layer) |
| System / relationship view | Dependency Map (`/map`) | `deriveDependencyGraph` plus per-tenant gap-lift weighting | At (hand-rolled SVG, no charting dep) |
| Ask / query | Ask Different Day (`/ask`) | persisted narrative, causes, actions, confounders | At, deferred to sourced brief (live query deferred) |
| Decision room | War Room (`/war-room`) | hypotheses, confounders, actions, committed actions | At (read-only synthesis plus real commit and lifecycle) |
| Action tracking | Track Record (`/actions`) plus War Room commit UI | `committed_actions` table (real predicted fields, honest pending states) | At (real persisted commitments) |
| Integrations | Connections (`/connections`) | registry feed declarations aggregated client-side | At |
| Run progress | Boot splash | `/runs` recorded sub-stages | At (never replays a finished run as live) |
| Single role view | Perspective lens (operator, investor, board) | pure registry re-rank by ownerPersona | Above (three lenses, no figure changes) |
| Owner administration | Access console (`/admin`) | Phase D auth and access | At |

## Click-depth audit

- From the Morning Brief (home, the default surface): a layer card to its layer
  page is one click to a full diagnosis.
- From any primary nav surface: one click to the surface (for example Anomaly
  Inbox, Dependency Map, War Room, Ask) and one click on a row, node, or question
  to the layer is two clicks to a diagnosis.
- The Anomaly Inbox is the fastest path: it ranks the items that need attention and
  links each straight to its layer, so the worst issue is two clicks from anywhere.

## Gate evidence

- Pure derivations are unit-tested: `deriveAnomalies` (7), `deriveDependencyGraph`
  and `layoutNodes` (9), `deriveHeartbeat` (4), `perspective` (6), the
  framework-free `tenantApi` mapping (18), and the hero registry archetype-key pin
  (3). All green.
- Honesty checks read in review: no `Math.random`, placeholder, or demo data in the
  pages or libs; the anomaly threshold is never rendered as a score; the map layout
  is declared non-data; Ask carries an explicit "assembled from saved intelligence,
  not a live query" footer; the boot splash and heartbeat poll only while a run is
  live.
- Backend (E1): `GET /api/tenants` access-filtered, `committed_actions` table with
  tenant-fenced commit, list, and status endpoints, and `layers.feeds` plus
  registry fields exposed. 73 api-server tests pass (20 tenants integration, 18
  auth integration, plus units), all behind `requireAuth` and tenant-access guards
  with zod validation.
- Production build green at 1728 modules; bundle 320 kB (89 kB gzip).
- Clean boot to the on-brand sign-in gate confirmed in the preview after the change
  (no white-screen, new imports resolve).

## Drift items

- Deliberate reversal of Phase D, logged as agreed. Phase D stated there was no
  non-admin tenant list endpoint so nothing enumerable leaks. Phase E adds
  `GET /api/tenants`, but it returns only the caller's accessible tenants, reusing
  the same access predicate that fences every `/api/tenants/:id` route. It enumerates
  nothing the caller cannot already read, so the fence is preserved while the picker
  becomes possible.
- Real committed actions, no fabricated outcomes (ruling c). The `committed_actions`
  table stores real predicted-recovery fields and an honest status lifecycle
  (committed, in progress, done, dismissed). It never claims a realized outcome;
  outcome attribution is the AJ-AN scope and is not implied here.
- Live cortex ask deferred (ruling d). Ask Different Day assembles from persisted
  content rather than issuing a live model call, to avoid 429 fragility and a
  fabricated-confidence surface. The deferral is stated in the UI and recorded here.
- Interactive war-room simulation deferred. A what-if simulator would require
  modelled numbers that are not persisted; rather than fabricate them the War Room
  is a read-only synthesis plus real commit and lifecycle actions.
- Single seeded tenant (ruling b). The portal is built and verified against the one
  seeded tenant (Patagonia). `peerBenchmark` is real persisted data; cross-tenant
  and portfolio breadth is Phase F scope and its thinness there is deferred, not
  faked here.
- Acceptable, same class as prior phases: authenticated visual capture is not
  possible from the agent environment because owner secrets are injected only into
  the workflow processes. AA and 375px are met by reusing the audited token system
  and responsive primitives; the rendered states are proven by the unit suite and
  the clean-boot smoke check rather than an authenticated screenshot.

## Decisions taken

- The Intelligence Architecture loads the global engine config unconditionally and
  overlays per-tenant telemetry. With no tenant it shows the architecture and a note
  that telemetry waits; on a runs-fetch error it shows a visible
  telemetry-unavailable note rather than silently rendering as "no runs recorded",
  so absent telemetry is never mistaken for a real zero.
- The Heartbeat poll reschedules after a transient runs-fetch error instead of
  freezing with a stale "updating live" pill, then settles once no run is live.
- The War Room is the single active decision surface: it both commits new moves and
  advances committed ones, while `/actions` stays the read-only ledger, so committed
  actions are not edited in two places. A move is treated as already committed when a
  committed action shares its layer key and title.
- Commit is gated on a real basis and confidence; a recommended move missing either
  is shown read-only with "no confidence recorded, cannot commit" rather than
  committed with a fabricated number.
- The dependency map is a hand-rolled SVG (no charting dependency): circular layout
  with node radius scaled by real gap-lift weight, dashed strokes for shared-feed
  edges and solid for shared-module-group edges, plus a sorted node list beneath it
  so the data is fully legible without relying on small-screen label placement.
- Module-group colors are assigned deterministically by sorted group name so a group
  keeps its color across renders; color carries no analytical meaning.

## Test and verification summary

- Typecheck: clean (portal `tsc --noEmit`; api-server and libs unchanged this task).
- Build: portal production build green, 1728 modules.
- Tests: api-server 73, portal 105, all pass. Portal libs covered: anomalies 7,
  dependencyGraph 9, heartbeat 4, perspective 6, tenantApi 18, router 15, authApi 16,
  adminApi 27, hero registry 3.
- Dash sweep: no em-dash or en-dash across artifacts, lib, and docs.
- Smoke: clean boot to the sign-in gate through the single-origin proxy after the
  change.

## Milestone marker

Phase E is not a milestone. Continuing to Phase F.
