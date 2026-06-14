# Phase M: full verification of the connector and SOC 2 stage

Phase id: M. Name: Stage 2 Full Verification and the Build-Report Append. Milestone:
no, but gated (a per-phase hard stop for owner review before the next stage).

Phase M is the closing gate of the V2 data-connector and SOC 2 stage (Phases H
through L). It builds no product feature: it verifies the stage against Part 8 of the
connectors addendum and writes the build-report append that Part 8 item 11 requires.
The architecture under test is already gated and frozen from H through L; Phase M
changed no product code. It ran the verification suite, measured the connected-refresh
latency on the real path, swept for long dashes in source and in data, and recorded
the honest implemented-versus-declared status. This phase added zero npm dependencies
and contains no em-dash or en-dash.

## What Phase M did

- Re-ran the full verification baseline (typecheck, build, the whole test suite, the
  source dash guard) and captured the result as the gate evidence below.
- Mapped every one of the eleven Part 8 acceptance items to the concrete source and
  test that proves it, and recorded the two items that are honestly partial rather
  than claiming a pass they do not have.
- Measured the connected-refresh latency on the real path (the generic-sql warehouse
  connector through `refreshConnectedTenant` against a real PostgreSQL-wire warehouse),
  not the stubbed integration path, so the latency tradeoff is on record with a real
  number.
- Swept both sides for long dashes: the source guard over lib, artifacts, docs, and
  scripts, and a row-cast sweep over every public table.
- Appended the Phase M section to `docs/build-report-v2.md` with the framework, the
  catalogue, implemented versus declared, the new tables and routes, the split-pipeline
  cortex change, the subprocessor list, and the measured refresh time.

## Part 8 acceptance checklist

1. Typecheck and build pass clean. Met: both run green across the workspace (exit 0).
2. The registry lists the full Part 1 catalogue, and at least two connectors per
   family run end to end. Partial, and logged honestly. The catalogue is the full 46
   connectors across all ten families (the connectors table holds 46 rows; the registry
   returns an honest "available, not connected" for any declared-but-unimplemented
   key). The "at least two per family run end to end" half is met for the
   bring-your-own-warehouse family only (`generic-sql` and `redshift`, both implemented
   and proven end to end against a real Postgres-wire warehouse). The other nine
   families are declared-only with correct layer and signal mapping but no runtime, so
   they do not run end to end. This is the staged design the addendum itself models
   (item 11 asks for the implemented-versus-declared split), not a regression. See the
   logged drift below.
3. A connector returning raw records is rejected by the schema guard and the run fails
   loudly. Met: `lib/connectors/src/guardedExtractSignals.test.ts` proves a raw email
   string in a signal value is rejected by `assertDerivedSignalSet` and the run throws;
   the connected refresh path proves the same end to end
   (`connectedRefresh.integration.test.ts`, the "fails the run loudly when a connector
   returns raw content" case, which also proves the prior good signals are untouched).
4. The extraction path has no database or filesystem write capability. Met:
   `guardedExtractSignals.ts` patches the `node:fs` write surface for the duration of an
   extraction and the test proves `writeFileSync` throws and writes nothing; the
   connector context carries no database handle by construction (only resolveSecret,
   tokenize, now, log), and the static import-boundary test forbids `node:fs` and the db
   root in connector and edge-agent source.
5. `outside_in` tenants behave exactly as before and the regression contract holds.
   Met: the orchestrator branches on `tenants.dataMode` and outside_in takes the
   original path; the grounding regression test proves the outside_in prompts are
   byte-for-byte unchanged, and the full suite (which carries the Phase B through G
   acceptance sets) is green.
6. A connected tenant grounds only on `derived_signals`, the raw extraction is
   discarded, and the external model seats receive only de-identified signals. Met:
   `loadLayerGrounding` reads only `derived_signals` (numeric scalars, a vector rendered
   as `vector[len]`, never raw text); the Tier 2 split routes only the in-boundary Lens
   over raw-adjacent material while the external Synthesist and adversarial seats receive
   the profile, the Lens output, and the math-only grounding (the cortex grounding tests
   assert the external payload shape); the connector discards its warehouse connection on
   return and persistence happens only in the caller.
7. Revoking a tenant key makes that tenant's signals unreadable immediately, and the
   Security posture view shows it as crypto-shredded. Met: `tenantKeyService.revokeTenantKey`
   destroys the KEK material before committing the revoked status; `signalRead` throws a
   typed `CryptoShreddedError` on the next read; the security integration test proves the
   read returns `crypto_shredded` rather than any plaintext after revoke, and the Phase L
   posture view renders the revoked, crypto-shredded state.
8. No member has standing access; access requires an owner-approved, time-boxed, logged
   break-glass grant that expires on its own. Met: `breakGlass.requireActiveBreakGlassGrant`
   enforces an active, unexpired, unrevoked grant for every role including owners, every
   read appends an `access_grant_events` row, and the integration test proves expiry and
   revoke both deny while a valid grant enables the read and logs it.
9. The provenance ledger is append-only, each entry chains to the prior by hash, and the
   UI can verify chain integrity. Met, with a logged residual. The ledger module exposes
   only `appendEntry` and `verifyChain` (no update, no delete), links each entry by
   content hash, and serializes per-tenant appends on a Postgres advisory lock; the Phase
   L Provenance panel verifies the chain and reports intact or broken with length, broken
   index, and detail; `verifyChain` is tested on clean and deliberately corrupted chains.
   The append-only guarantee is enforced at the application layer plus the hash chain;
   database-role-level write blocking (revoking UPDATE and DELETE on the table) is a
   deployment-time hardening that is not in place and is logged as residual drift.
10. The long-dash sweep returns zero. Met on both sides: the source guard over lib,
    artifacts, docs, and scripts is zero, and the row-cast data sweep over all 24 public
    tables is zero.
11. Append the connector framework, the catalogue, implemented versus declared, the new
    tables and routes, the split-pipeline cortex change, the subprocessor list, and the
    measured connected-refresh time to `docs/build-report-v2.md`. Met: the Phase M
    section was appended with all seven elements, including the measured refresh time
    recorded below.

## The measured connected-refresh time

Item 11 requires the connected-refresh latency on record so the tradeoff is explicit.
The number was measured on the real path, not the stubbed integration test: the
`generic-sql` warehouse connector run through `refreshConnectedTenant` against a real
PostgreSQL-wire warehouse (the local Postgres reached as a warehouse over DATABASE_URL),
with a disposable 5,000-row warehouse table and four aggregate-only measures (a row
count, an average, a sum, and a grouped distribution). One warmup run was discarded,
then three timed runs were taken; the temporary tenant and table were deleted after.

- Per run: 51.2 ms, 60.9 ms, 67.6 ms. Median 60.9 ms, range 51.2 to 67.6 ms.
- Each run extracted four measures, fanned them across the fourteen layers the
  generic-sql connector feeds (56 `derived_signals` rows), sealed every value in its own
  AES-256-GCM envelope under the tenant key, and stamped a provenance root on the run.
  All 56 stored values were verified to be encrypted envelopes, not plaintext.
- This is a local Postgres-wire measurement of the in-boundary extract, derive,
  encrypt, and persist path. It is not client wide-area-network latency: a real client
  warehouse over a network link adds round-trip and query time on top of this floor. The
  number records the in-boundary processing cost the connected mode adds over outside_in
  (which has no extraction and no encryption), which is the tradeoff Part 8 asks to make
  explicit.

To reproduce, run the `generic-sql` connector through `refreshConnectedTenant` against a
Postgres-wire warehouse seeded with a multi-thousand-row table and four aggregate-only
measures, discard one warmup run, and time the next three. The measurement script was
throwaway and was deleted after the run (it imports the real refresh path, seeds and then
drops a disposable tenant and table, and prints the per-run timings and the envelope and
provenance verification), so the figures above are the recorded result of that run, not a
committed benchmark.

## Logged drift and deviations

- Item 2 is partial by staged design. Only the bring-your-own-warehouse family has the
  two implemented connectors that run end to end (`generic-sql`, `redshift`); the other
  nine families are declared with correct layer and signal mapping but have no runtime,
  so the registry returns "available, not connected" for them and the connected refresh
  rejects them honestly. The full "two per family run end to end" is the end-state
  acceptance for the later connector phases; the warehouse-bi reference pair was the
  Phase H deliverable and the remaining families stay declared because their drivers
  would be new dependencies (held off under the zero-new-dependency rule). Reported as
  implemented versus declared in the build-report append, never faked.
- Item 9 has a residual hardening item. Append-only is enforced at the application layer
  (insert-only API, no update or delete path) plus the hash chain plus the serialized
  append, and the UI verifies the chain. Database-role-level append-only enforcement
  (revoking UPDATE and DELETE on the provenance table at the role level) is not in place;
  it is a deployment-time hardening left to the operator and is carried as still-live
  drift in `rollup.md`. It was deliberately not added in Phase M, which is a
  verification and reporting gate, not a build phase, and Part 8 item 9 does not require
  database-enforced append-only.
- Phase M changed no product code. The only artifacts are the documentation (this
  report, the build-report append, the INDEX and rollup updates) and a throwaway latency
  measurement script that was deleted after the run.

## Verification

- Typecheck and build are green across the workspace (exit 0 on both).
- The full suite is green: 382 tests (api-server 123, portal 144, cortex 66,
  connectors 27, edge-agent 10, db 8, scripts 4). No new tests were added this phase;
  the suite is the standing acceptance evidence for items 3 through 8 and the regression
  contract.
- The connected-refresh latency was measured on the real warehouse path and recorded
  above (median 60.9 ms on local Postgres-wire), with the persisted output verified to
  be encrypted math with a provenance root.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, and
  scripts, and the row-cast sweep over all 24 public tables.
- Zero new npm dependencies.

## Remediation iterations

- The architect was consulted up front with `responsibility: plan` to shape the
  verification trajectory before any work, and confirmed Phase M should be verification
  and documentation only, that item 2 must be marked partial and item 9 met-with-caveat
  rather than rubber-stamped, and that the refresh time must be measured on the real path
  rather than the stub. The plan was followed.
- The architect was then run with `responsibility: evaluate_task` and
  `includeGitDiff: true` over the Phase M documentation and the cited source. It returned
  a PASS: the documentation is materially honest and accurate against the code and tests,
  item 2 is correctly partial and item 9 correctly met-with-residual, the
  implemented-versus-declared catalogue claim matches the registry, and the latency
  framing is honest (a local Postgres-wire floor on the real path, not client wide-area-
  network performance). It raised one non-severe wording fix: the subprocessor list's
  seat parenthetical understated Anthropic's role, since Anthropic also backs the profile,
  the outside_in Lens, the Evaluator, and the enrichment paths, not only the Synthesist.
  The build-report subprocessor sentence was broadened accordingly, and a reproducibility
  note was added to the latency section. No product code change was requested or made.

## Gate

Phase M is gated. It closes the connector and SOC 2 stage. Execution pauses here for
owner review before the next stage. Do not auto-advance.
