# Phase AM: the as-of replay and the diligence pack

Phase id: AM. Name: the as-of replay and the diligence pack. Milestone: no (a gated per-phase stop; the
build advances to Phase AN after the AM gate). Phase AM is the third phase of Stage 6, the final stage, run
under the owner authorization that cleared the AJ milestone pause to execute the AK-AL-AM-AN sequence
linearly.

Phase AM gives the platform a memory and a way to hand that memory to an outsider. Two things land
together. The as-of replay reconstructs what the system believed on a past date, layer by layer, with the
confidence and data efficacy it had earned by then and a diff of what has changed since; it reads only
append-only, timestamped state, so it reconstructs history faithfully and can never edit it. The diligence
pack is a single, self-contained, brand-styled HTML document that assembles a tenant's whole evidentiary
record for an outside reader (an acquirer, a board, an auditor): the current 14-layer diagnosis, the
data-efficacy and calibration record, the board-grade decision audit timeline, the outcome track record,
and a provenance integrity attestation, every figure read from the same persisted state the live surfaces
use. Zero new npm dependencies; ASCII hyphen only in source and in data; no fabricated telemetry, health,
or output.

## The as-of snapshot ledger

One honesty-bearing table is added (`lib/db/src/schema/tenantLayerSnapshots.ts`), taking the base-table
count from 43 to 44 (`tenant_layer_snapshots`). It exists because `tenant_layers` is upserted in place
(unique on `(tenant_id, layer_key)`), so a refresh overwrites the prior narrative, claim split, and
confounder verdicts. Without an immutable ledger of each build, a past diagnosis could not be reconstructed
and an as-of view would have to fabricate it, which the honesty boundary forbids.

`tenant_layer_snapshots` holds one APPEND-ONLY row per layer (re)build:

- The content fields mirror `tenant_layers` field for field (content, hero panel, peer benchmark,
  supplement blocks, confounders, the verified and modelled claim split, voice quality, reduced-mode flag,
  generator model). They are written from the SAME dash-stripped row the upsert uses, so a snapshot is
  byte-identical to the live row at build time and is itself dash-clean.
- `rawConfidence` is the overall numeric confidence the assembler wrote onto the content at build time,
  snapshotted so the as-of confidence advisory can be recomputed against the forecasts resolved by the
  as-of date; it is null when the content carried no overall confidence (an honest absence).
- `contentHash` is a sha256 over a canonical, stable-key serialisation of the content payload
  (`contentHash.ts`: object keys sorted at every depth, array order preserved, nullable fields normalised
  to null). It is the fingerprint the "what changed since" diff compares: two builds that produced
  identical content hash equal, a real change does not. `generatorModel` and `rawConfidence` are
  deliberately excluded from the hash, since the as-of diff surfaces those separately.
- `dataMode` and `feeds` are the tenant data mode and the layer feed list in effect for THIS build. They
  are snapshotted because reading the tenant's CURRENT mode or the layer's current feeds would fabricate a
  figure the system never held then: a tenant that later connected would retroactively gain a higher
  efficacy ceiling on a past date, and an as-of coverage figure computed against the current denominator
  would not match what was true then.
- `signalMeta` (jsonb, default `[]`) is the connected-signal metadata that grounded THIS build: per source
  signal, its connector key and `computedAt` (the SAME de-identified pair already in `derived_signals`,
  never raw client content). It is captured because `derived_signals` is delete-replaced on every refresh
  (`persistDerivedSignalSet`), so the live table can no longer answer "what grounded the build on a past
  date"; without it the as-of coverage, freshness, and source-diversity drivers would read the CURRENT
  signals and understate or null out a past connected build. An outside-in build, or a layer with no
  grounding, captures an honest empty set.
- The efficacy index is deliberately NOT stored. It is a read-time derivation everywhere else; recomputing
  it from the snapshot's own claim arrays plus its captured `signalMeta` keeps it from drifting from its
  inputs, which a frozen stored figure would risk.

Append-only is enforced at the application layer, mirroring `provenance_ledger`: rows are inserted, never
updated or deleted. `layerKey` is a plain text key (no foreign key), consistent with `committed_actions`,
`forecasts`, and `decision_records`, so removing a custom layer can never orphan the history of what that
layer once said.

## Writing the snapshot atomically

`artifacts/api-server/src/lib/pipeline/orchestrator.ts` writes the snapshot in the SAME transaction and at
the SAME `builtAt` instant as the `tenant_layers` upsert. A crash between the two would overwrite history
without preserving it, defeating the no-edit guarantee the ledger exists to hold, so both writes share one
transaction. The snapshot is built from the same dash-stripped row (inheriting its dash-cleanliness),
captures the build-time `dataMode`, `feeds`, and `signalMeta` (the last mapped from the grounding signals'
connector key and `computedAt`), and computes the `contentHash` over the same content payload. The snapshot
is inserted, never updated.

## Reconstructing a past state

`artifacts/api-server/src/lib/replay/asOf.ts` (`buildTenantAsOf`) reconstructs one tenant's state as of a
past instant, or returns null when the tenant does not exist. It reads ONLY append-only, timestamped state:

- The diagnosis content comes from `tenant_layer_snapshots`: per layer, the latest snapshot whose
  `snapshotAt` is at or before the requested date. A layer with no build by then is honestly
  `available: false` with reason `no_snapshot_available` (a pre-Phase-AM tenant, or a layer not yet built),
  never a fabricated empty diagnosis.
- The efficacy index is recomputed from that snapshot's OWN inputs (its captured `dataMode`, `feeds`, claim
  arrays, confounders, and `signalMeta`) through the same `buildLayerEfficacy` every other surface uses,
  with the newest captured signal aged against the as-of date. A later refresh that delete-replaces the
  live `derived_signals` therefore cannot rewrite a past connected build's coverage or freshness.
- The confidence advisory is recomputed from the forecasts RESOLVED by the as-of date
  (`computeLayerConfidenceAdvisory` with the as-of cutoff), so it shows the track record the layer had
  earned by then.

The "current" side of every diff is read the same way from the latest snapshot, so the comparison is
snapshot to snapshot. The pure diff math (`asOfMath.ts`, `diffLayerSummaries`) compares the two summaries
by content hash and the verified, modelled, and confounder counts and the two derived figures; each delta
is current minus as-of and is null unless BOTH sides carry the figure, so a surface says a value is
unavailable rather than implying a move from or to zero. The tenant view also carries honest growth figures
read from timestamped state: the provenance ledger depth as of the date versus now, and the decisions and
graded outcomes recorded since.

## The diligence pack

`artifacts/api-server/src/lib/diligence/pack.ts` assembles and renders the pack. `buildDiligencePack` reads
every figure from persisted state through the same services the live surfaces use (`loadTenantEfficacy`,
`getDecisionTimeline`, `verifyChain`, the calibration Brier aggregate, and the per-layer confidence
advisory), so the pack can never drift from the app and never fabricates a number. `renderDiligencePackHtml`
is a PURE function of that assembled data that builds one self-contained HTML document by hand (zero new
dependencies; the only runtime cost is string assembly over already-loaded data). The honesty boundary is
carried THROUGH to the page:

- The current 14-layer diagnosis shows each layer's verified count beside its modelled count, never
  collapsing the distinction, with a plain note that modelled findings are reasoned estimates.
- The efficacy rollup states the data mode honestly and shows the structural ceiling for an outside-in
  tenant ("Mode ceiling N", "structurally capped"); the calibration headline carries its sample label and
  whether it beats the naive baseline.
- The decision audit timeline renders the overruled verdict off the exact `deriveOverruledStatus` contract
  ("right", "wrong", "pending"), and a decision that followed the advice carries no pill.
- The provenance integrity banner states plainly whether the hash-chained ledger verified, and flags a
  broken chain at its entry rather than asserting integrity.
- Every tenant-controlled string is HTML-escaped, so the export cannot inject markup.

It is an export, not an editor: the page states it is a read-only export of persisted state and that history
cannot be edited through it.

## Routes

`artifacts/api-server/src/routes/tenants.ts`, both behind `requireTenantAccess` and both read-only (GET):

- `GET /tenants/:id/as-of?at=<ISO>` returns the as-of replay. A missing or unparseable `at` is a
  `400 invalid_as_of_date`; an unknown tenant is a `404 tenant_not_found`.
- `GET /tenants/:id/diligence-pack.html` returns the pack as a self-contained `text/html` document served
  inline (with a sanitised filename); an unknown tenant is a `404 tenant_not_found`.

## Portal

- `artifacts/portal/src/types.ts` adds the as-of replay types.
- `artifacts/portal/src/lib/replayApi.ts` is a framework-free client (the as-of fetch and the diligence-pack
  URL helper) mirroring the existing API clients, with a 401 mapped to an unauthorized signal.
- `artifacts/portal/src/components/pages/AsOfReplayPage.tsx` renders the date picker and the per-layer
  reconstruction with its confidence, efficacy, and the "what changed since" diff;
  `DiligencePackPage.tsx` offers the export; and `BoardPackPage.tsx` links it. Each carries distinct
  loading, ready, empty, and error states and a dash, never a fabricated zero, for a missing figure.

## Tests

- `artifacts/api-server/src/lib/replay/asOfMath.test.ts` (9). The pure diff math: the claim-item and
  object-array counts matching the efficacy service's predicate, and `diffLayerSummaries` returning
  content-changed by hash, current-minus-as-of deltas, and null deltas (never zero) when either side is
  absent.
- `artifacts/api-server/src/lib/replay/contentHash.test.ts` (7). The canonical serialisation (sorted keys at
  every depth, array order preserved, null normalisation) and `hashLayerContent` hashing equal for
  structurally-equal content and differently for a real change.
- `artifacts/api-server/src/lib/replay/asOf.integration.test.ts` (7). Against live Postgres with a throwaway
  tenant and layers: a revised layer's as-of view shows the FIRST build (not the later rebuild) and diffs it
  current-minus-as-of, a stable layer is unchanged with zero deltas, a layer built only after the date is
  honestly unavailable with the diff recording a build has appeared, the honest ledger-growth and post-date
  decision and outcome counts, replaying is a pure read that writes nothing and reconstructs
  deterministically, the as-of efficacy honours the data mode CAPTURED at build time (an outside-in build
  keeps its capped ceiling even though the tenant is connected now), the as-of connected efficacy is
  recomputed from the snapshot's captured signal metadata and NOT the delete-replaced live signals (coverage
  and freshness stay measured for the past date), and an unknown tenant returns null.
- `artifacts/api-server/src/lib/diligence/pack.test.ts` (6). The pure render: the brand frame and the honest
  read-only export note, verified labelled beside modelled, the overruled pill rendered off the exact
  timeline status contract (the regression guard against a prefixed key silently dropping the pill),
  tenant-controlled strings HTML-escaped, the data mode stated honestly with the outside-in ceiling capped,
  and a broken provenance chain flagged at its entry rather than asserted as verified.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 1034 tests (api-server 610 across 69 files, portal 263 across 21 files, cortex 110
  across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4), up 29 from
  Phase AL's 1005. The new tests are api-server `asOfMath` (9), `contentHash` (7), `asOf.integration` (7),
  and `pack` (6).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase AM
  Markdown, and a fresh database-wide cast over all 183 public text and jsonb columns across the 44 base
  tables (one table added in AM) reports zero hits.
- Zero new npm dependencies (workspace packages and Node built-ins only; the pack HTML is built by hand, and
  the snapshot reuses `drizzle-orm` writes and `node:crypto`).

## Honest marking

What is TEST-PROVEN here: the pure as-of diff math (`diffLayerSummaries` and its counts) and the canonical
content hashing (`hashLayerContent`); and, against live Postgres, the layer-by-layer reconstruction picking
the latest snapshot at or before the date, the honest unavailable state for a layer not yet built, the
current-minus-as-of diff with null (never zero) when a side is absent, the as-of efficacy honouring the
build-time data mode, the as-of connected efficacy recomputed from the snapshot's captured signal metadata
rather than the delete-replaced live signals, the deterministic pure-read replay, and the honest
ledger-growth and post-date counts; and the diligence pack's pure render with its verified-beside-modelled
labelling, the overruled-status contract, the HTML escaping, the outside-in ceiling, and the broken-chain
flag.

What is SOURCE-REVIEWED rather than test-proven (the accepted LOWs): the diligence pack's DATA ASSEMBLY
(`buildDiligencePack`) and the two HTTP routes are exercised only through the services they call (the
efficacy, calibration, timeline, and chain reads behind them ARE tested) while the pure render and the
as-of read-model ARE directly tested; and the portal as-of and diligence surfaces (`replayApi.ts`,
`AsOfReplayPage`, `DiligencePackPage`) are source-reviewed, with no portal-side unit test added this phase
(mirroring the AE, AF, AG, AJ, AK, and AL portal items).

Nothing is fabricated: a layer with no build by the as-of date shows an honest unavailable state rather than
an empty diagnosis, a delta is null when a side is missing rather than implying a move from zero, a past
connected build's efficacy is recomputed from what actually grounded it rather than from superseded live
signals, and the diligence pack flags a broken provenance chain rather than asserting integrity.

## Logged drift and deviations

- The diligence pack data assembly and the as-of and diligence routes are source-reviewed, not behind a
  dedicated integration test (AM). `buildDiligencePack` and the `GET /tenants/:id/as-of` and
  `GET /tenants/:id/diligence-pack.html` routes are compile-verified and source-reviewed, while the as-of
  read-model (`buildTenantAsOf`) IS integration-tested against live Postgres, the pack render
  (`renderDiligencePackHtml`) IS unit-tested, and the efficacy, calibration, timeline, and chain services
  the assembly calls ARE tested. Accepted as logged drift, mirroring the prior read-route items; a future
  integration test seeding a full tenant can close it.
- No portal-side rendering test for the as-of and diligence surfaces, and the `replayApi` client is
  source-reviewed (AM). `AsOfReplayPage`, `DiligencePackPage`, and the `replayApi.ts` client are
  source-reviewed; the as-of read-model and the pack render behind them ARE tested. Accepted as logged
  drift, mirroring the AE, AF, AG, AJ, AK, and AL portal items; a future lightweight portal test, including
  a `replayApi` client test, can close it.

## Gate

Phase AM passed its architect `evaluate_task` review (PASS) after two remediation rounds. The final round
closed a connected-signal supersession blocker: the as-of efficacy originally recomputed its
connector-grounded drivers from the LIVE `derived_signals`, which `persistDerivedSignalSet` delete-replaces
on every refresh, so a refresh after the as-of date erased the very signals that grounded a past connected
build and the replay understated or nulled its coverage and freshness. The fix captures the build-time
connected-signal metadata ON the snapshot (a new `signalMeta` jsonb column of de-identified
`{ sourceConnectorKey, computedAt }` references, the same pair already in `derived_signals`, never raw
client content), and the as-of efficacy recomputes from the snapshot's captured metadata; a regression in
`asOf.integration.test.ts` proves a post-as-of refresh cannot erase a past build's coverage or freshness.
The re-review confirmed the as-of read-model reads only append-only, timestamped state and edits nothing,
the efficacy and confidence are recomputed honestly from what the build actually held, the diff is null
rather than zero when a side is absent, the diligence pack assembles from persisted state and flags a broken
chain rather than asserting integrity, and the hard constraints hold (zero new dependencies, ASCII hyphen
only in source and data, no fabricated figure). The drift index, the rollup, and the V2 build report are
updated to "A through AM". Phase AM is not a milestone; the build advances to Phase AN (the final
verification and the consolidated report that closes Stage 6 and the whole build).
