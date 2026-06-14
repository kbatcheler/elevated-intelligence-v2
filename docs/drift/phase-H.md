# Phase H: Connector Framework and Registry

Phase id: H. Name: Connector Framework and Registry. Milestone: yes (hard stop for
owner review before Phase I).

The first phase of the V2 data-connector addendum. It builds the uniform connector
contract, the DerivedSignalSet guard at the connector boundary, the full
connector catalogue mapped to the 14 layers, the Part 4 schema additions, and the
two bring-your-own-warehouse reference connectors proven end to end through the
derive-and-discard path. This phase added zero npm dependencies and contains no
em-dash or en-dash.

## Build summary

- **A new internal workspace package, `lib/connectors`.** It mirrors `lib/cortex`:
  composite tsconfig, referenced from the root and from the api-server, wired
  through pnpm. It depends on `@workspace/db` (for the DerivedSignalSet contract
  only), `pg`, and `zod`, all already in the lockfile.
- **The uniform connector contract** (`src/contract.ts`). `Connector`,
  `ConnectorDescriptor`, the ten `ConnectorFamily` values, `AuthMethod`,
  `DeploymentMode`, `ConnectorStatus`, `DataPath` with a documented note per path,
  `ExtractionScope`, and a capability-minimal `ConnectorContext` (resolveSecret,
  tokenize, now, log; no database handle, no filesystem). It imports the
  DerivedSignalSet contract from the side-effect-free `@workspace/db/contracts`
  subpath only, never the db root.
- **The full catalogue** (`src/catalogue.ts`). All ten families, 46 connectors,
  each mapped to the layers it feeds, with auth method, deployment mode, declared
  signals, status, and data path. Only `generic-sql` and `redshift` are marked
  implemented; the other 44 are declared.
- **The registry** (`src/registry.ts`). listCatalogue, getDescriptor,
  isImplemented, getConnector. A declared-but-unimplemented connector throws an
  honest "available, not connected" error.
- **Two reference connectors** (`src/connectors/warehouse.ts`). A shared pg-based
  engine for the bring-your-own-warehouse path: it opens its own read-only
  connection to the client warehouse and computes client-declared measures
  expressed as a structured, parameterized DSL (an allow-listed aggregate or a
  ratio of two over a validated column, with predicate filters whose values are
  bound parameters), never as SQL. The engine builds the aggregate SELECT itself
  inside a read-only transaction, reads only the numeric column `v`, guards the
  return through assertDerivedSignalSet, and discards the connection. There is no
  free-form query path, so a raw column can never be projected.
- **Part 4 schema** (`lib/db/src/schema/`, pushed). connectors,
  tenant_connections, connector_runs, derived_signals, provenance_ledger,
  tenant_keys, and a dataMode column on tenants. access_grants was already present
  from Phase D and is unchanged.
- **Catalogue seed** (`artifacts/api-server/src/scripts/seedConnectors.ts`). An
  idempotent upsert that projected the registry into the connectors table: 46 rows.

## Requirements checklist

- The connector framework exists: one uniform contract plus a registry. Done.
- The full catalogue from Part 1 is declared and mapped to the 14 layers. Done: 46
  connectors across all ten families, each mapped to canonical layer keys
  validated by test against the live layer registry.
- At least two reference connectors in the bring-your-own-warehouse family run end
  to end through the derive-and-discard path. Done: generic-sql and redshift,
  proven against a real Postgres-wire warehouse in the test suite.
- A connector that attempts to return raw records is rejected and the run fails
  loudly. Done, proven by test: there is no free-form query path at all, a leaky
  connector returning a raw string fails the DerivedSignalSet guard, and an
  aggregate over a non-numeric column is rejected at the numeric cast.
- The extraction path has no database or filesystem write capability. Done, proven
  by the capability-minimal context plus a static import-boundary test that fails
  if any connector source imports the db root.
- Schema additions from Part 4 added and pushed. Done; push applied cleanly,
  lib/db typecheck green.
- Anything declared but not implemented renders as "available, not connected" and
  never fakes data. Done: the registry returns the honest error, and the table
  stores status only, never invented outputs.
- Typecheck, build, and the full suite green; em-dash sweep zero. Done (see below).

## Drift items

Category sweep first, then specifics. Every item is acceptable drift.

- Faked, stubbed, scripted, or hardcoded output where real output was required:
  none. The two reference connectors run real aggregate SQL against a real
  warehouse and return computed math; the other 44 are honestly declared and
  return the "available, not connected" error, not stub data. The declared signal
  keys in the catalogue are declarations of capability, not measurements.
- Renamed tables, substituted libraries, or restructured layout to route around a
  problem: none. The schema matches the Part 4 names exactly; no library was
  added or swapped.
- Weakened checks to pass the gate: none. The connectors test that asserts "no
  write to our store" counts rows through a raw pg connection rather than
  importing drizzle, precisely so the connector source keeps its no-db-root
  discipline; no assertion was relaxed.
- Scope added beyond the phase ask: none beyond the package scaffolding the spec
  asked for. Routes, the connected-mode pipeline branch, the split pipeline, the
  provenance writes, and the portal screens are deliberately not built here; they
  are Phase I and later.
- Silent assumptions or defaults: none silent. The decisions are stated below.

Specific items:

- [acceptable] Two connectors implemented, 44 declared. The spec's full "at least
  two per family run end to end" is the end-state acceptance for the later
  connector phases. The Phase H execution order asks specifically for the two
  warehouse reference connectors, which are done; the rest are declared and render
  as available, not connected. This is the phased plan, not a shortfall.
- [acceptable] The connectors table stores the catalogue surface only (key, name,
  family, layers, auth method, deployment, declared signals, status). The
  registry-only fields `path` and `implemented` are not columns: `path` is audit
  documentation carried in the registry, and `implemented` is a runtime property
  of whether a connector object exists, not catalogue data. No information is lost;
  the registry remains the source of truth.
- [acceptable] Postgres stands in for the client warehouse in the end-to-end test.
  Redshift speaks the Postgres wire protocol and generic-sql targets any
  Postgres-wire-compatible warehouse, so the test exercises the real node-postgres
  driver and real aggregate SQL against a throwaway schema, not a mock. Snowflake,
  BigQuery, and Databricks remain declared (their drivers would be new
  dependencies, held under the zero-new-dependency rule).
- [acceptable] Defense in depth, layered. The primary guarantee is that the
  connector builds the aggregate SELECT itself from a structured DSL, so a raw
  column cannot be projected by any path; the numeric cast on the projection, the
  `BEGIN TRANSACTION READ ONLY`, the numeric `v` coercion, and the DerivedSignalSet
  boundary check are additional layers.

## Decisions taken

- A new `lib/connectors` package rather than a folder inside api-server. The spec
  offered either; a workspace package keeps the contract importable by the
  api-server and a future in-client agent without dragging in the server, and it
  matches the existing lib/cortex and lib/db layout.
- The connector framework imports `@workspace/db/contracts` only, never the db
  root. Importing the db root opens the application Postgres pool as a side effect;
  keeping the connector path on the contracts subpath is what lets a connector run
  inside the in-client edge agent with no handle to our store. Enforced by a
  static import-boundary test.
- Declared connectors fail loudly with "available, not connected" instead of
  returning an empty or stub DerivedSignalSet, so a not-yet-built connector can
  never be mistaken for one that produced no signals.
- The data path is documented per catalogue entry (boundary-runtime, edge-agent,
  or file-edge) with a human-readable note, satisfying the Part 1 requirement to
  record which path each connector uses and that raw records never transit a
  third-party aggregator's cloud.

## Test and verification summary

- Typecheck: clean across the workspace (`pnpm run typecheck`).
- Build: green (`pnpm run build`; portal builds, api-server bundles).
- Tests: the full suite is green, including 21 new connectors tests (registry
  integrity 6, boundary guard 3, warehouse end-to-end 11, import boundary 1).
- Em-dash sweep, source: the strengthened guard reports zero.
- Em-dash sweep, data: zero over the seeded connectors catalogue (key, name,
  layers, and signals_produced checked for U+2014 and U+2013).
- Zero new npm dependencies: pg and @types/pg were already in the lockfile; the
  package reuses them and the internal workspace packages.

## Remediation iterations

- Iteration 1 (architect evaluate_task review, Fail then Pass after the fix). The
  first-pass warehouse extractor accepted a free-form read-only SELECT or WITH
  string per measure and screened it for write keywords, a single statement, and a
  numeric `v` column. The architect correctly flagged that this does not prove
  aggregate-only: a raw numeric projection such as `SELECT salary AS v FROM
  employees LIMIT 1` would pass, and a free-form WHERE could break out of the
  projection to add a raw column. Remediated by removing the free-form SQL path
  entirely: a measure is now a structured, parameterized DSL (an allow-listed
  aggregate or a ratio of two over a validated column, with predicate filters whose
  values are bound as query parameters), the connector constructs the aggregate
  SELECT itself, the projection is cast to a number, and row-returning aggregates
  cannot be expressed. New blocking tests cover the closed holes. On re-review the
  architect passed Phase H. The one non-blocking hardening note, making the measure
  config schemas reject unknown fields, was then applied (strictObject); cohort-size
  privacy beyond aggregate shape is recorded as a future-policy item, not an active
  leak.

## Verdict

Pass with noted acceptable drift. The framework, the catalogue, the Part 4 schema,
and the two warehouse reference connectors are built and proven; the
derive-and-discard guarantees (no app-DB handle, no filesystem, math-only return,
loud rejection of raw content) are enforced and tested. No blocking drift remains.

## Milestone marker

Phase H is a milestone hard-stop. Execution pauses here for owner review before
Phase I. Do not auto-advance.
