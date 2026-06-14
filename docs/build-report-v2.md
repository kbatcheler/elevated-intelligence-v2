# Build Report: Elevated Intelligence V2, Data Connectors and SOC 2 Architecture

The V2 addendum build report, required by the Data Connectors and SOC 2 Master
Prompt (Part 8, item 11). It is appended per phase as the connector and
production-architecture phases land, starting at Phase H. The core build report
for Phases A through G stays frozen at `docs/build-report-core.md`; this file
never restates it.

The governing principle for everything here is data minimization: derive and
discard. A connector touches raw client data, computes math, and returns only a
DerivedSignalSet. Our store holds the math, never the records.

## Phase H: Connector framework and registry

### What was built

- **The uniform connector contract** (`lib/connectors/src/contract.ts`). One
  interface every connector implements regardless of family: `key`, `family`,
  `layers`, `authMethod`, `deployment`, `signalsProduced`, and the single data
  path `extractSignals(scope, ctx)` returning a `DerivedSignalSet`. The
  `ConnectorContext` is capability-minimal by design: it can resolve a secret by
  reference, tokenize an identifier, read the clock, and log. It has no database
  handle and no filesystem capability, so the extraction path cannot persist
  anything. `ExtractionScope` carries a credential reference (`authRef`), never
  the credential itself, plus a non-identifying config.
- **The full catalogue** (`lib/connectors/src/catalogue.ts`). All ten families
  from Part 1, 46 connectors, each mapped to the 14 layers it feeds, with its
  auth method, deployment mode, declared signals, status, and a documented data
  path. The catalogue is the single source of truth; the `connectors` table is
  seeded from it.
- **The registry** (`lib/connectors/src/registry.ts`). `listCatalogue`,
  `getDescriptor`, `isImplemented`, and `getConnector`. A connector declared but
  not yet implemented throws an honest "available, not connected" error rather
  than returning a stub that could fake data.
- **Two reference connectors, proven end to end** (warehouse and BI family,
  `lib/connectors/src/connectors/warehouse.ts`): `generic-sql` and `redshift`,
  the bring-your-own-warehouse path. A shared pg-based engine opens its own
  read-only connection to the client warehouse (never our application database).
  The client declares measures in a structured, parameterized DSL, never SQL: an
  aggregate function from a fixed allow-list (count, count_distinct, sum, avg,
  min, max), or a ratio of two such terms, over a validated column, with any
  filters expressed as predicates whose values are bound as query parameters. The
  engine builds the SELECT itself so the projection is always an aggregate aliased
  to a numeric column `v` and cast to a number; row-returning aggregates such as
  array_agg cannot be expressed, and no client SQL string is ever executed. It
  runs inside a `BEGIN TRANSACTION READ ONLY`, guards every return through
  `assertDerivedSignalSet`, and discards the connection. Aggregate-only is
  enforced by construction, so raw records cannot leave the boundary.
- **Schema additions** (`lib/db/src/schema/`, pushed): `connectors`,
  `tenant_connections`, `connector_runs`, `derived_signals`, `provenance_ledger`,
  and `tenant_keys`, plus a `dataMode` column on `tenants` (`outside_in` default,
  or `connected`). `access_grants` already existed from Phase D and is unchanged.
  Each new table ships drizzle-zod insert schemas and inferred select types in the
  existing style, with pgEnums for the stable statuses and modes.
- **Catalogue seed** (`artifacts/api-server/src/scripts/seedConnectors.ts`). An
  idempotent upsert that projects the registry into the `connectors` table. It
  seeded 46 rows. No tenant connections and no outputs are created.

### Implemented versus declared

- Implemented (runtime proven through the derive-and-discard path): `generic-sql`
  and `redshift`, both in the warehouse and BI family.
- Declared (in the catalogue, mapped to layers, rendered as "available, not
  connected" until their runtime lands): the other 44 connectors, across all ten
  families. The spec's full "at least two per family run end to end" is the
  end-state acceptance for the later connector phases; Phase H proves the
  framework with the two warehouse reference connectors the execution order
  requires.

### New tables (routes come in Phase I)

The six new tables above are in place and pushed. No new HTTP routes were added
in Phase H: the Connections screen, the connected-mode grounding branch, the
provenance writes, the break-glass flow, and the security-posture view are the
Phase I and later deliverables (Parts 5 and 6 of the spec) and will be appended
here as they land. Nothing in Phase H wires the pipeline.

### Split-pipeline change to the cortex

Not in Phase H. The split into an in-boundary extraction zone and an external
synthesis zone (Part 3 Tier 2), and the `localModelAdapter` seat, are scheduled
for Phase I when connected-mode grounding is wired. The connector contract is the
foundation it sits on: `extractSignals` already returns only de-identified,
aggregated math, which is exactly what the external Synthesist and adversarial
seats are allowed to receive.

### Subprocessor list

Unchanged by Phase H, and recorded for the audit story. The external model
providers are the only data subprocessors: Anthropic (the Synthesist seat) and
Google Gemini (the Confounder and Challenger seats). In outside-in mode they
receive public homepage-grounded material. In connected mode (Phase I) they will
receive only the de-identified, aggregated DerivedSignalSet, never raw client
records. The connector architecture deliberately introduces no hosted-aggregator
subprocessor: raw client records never transit a third party. For warehouse
connectors the client's own warehouse is the source and our self-hosted boundary
runtime is the processor, so no new subprocessor is added.

### Measured latency (early evidence)

The full connected-refresh time (the in-client agent or boundary runtime plus the
layer reasoning) is measured when Phase I wires the connected pipeline, and will
be recorded here then. As early evidence, the reference warehouse extraction path,
end to end against a real Postgres-wire warehouse (open a read-only connection,
run three aggregate measures in a read-only transaction, guard the result, and
discard the connection), completes in well under a second per refresh in the test
suite. On this evidence the spec's latency tradeoff (a connected refresh may take
minutes, the price of staying out of the data-at-rest scope) is dominated by the
later layer reasoning, not by the extraction itself.

### Verification

- Typecheck, build, and the full test suite are green. The connectors package
  adds 21 tests: registry integrity (every connector maps to canonical layer keys
  validated against the live layer registry, unique keys, all ten families
  present, at least two implemented warehouse connectors), the boundary guard, the
  warehouse end-to-end path (including that there is no free-form SQL path, that an
  aggregate over a non-numeric column is rejected loudly, that an unknown aggregate
  or a missing required column is rejected, and that a filter value is bound as a
  parameter rather than executed as SQL), and the import-boundary check.
- A connector that tries to return raw content is rejected by the DerivedSignalSet
  guard and the run fails loudly (proven by test).
- The extraction path has no database or filesystem capability (proven by the
  capability-minimal context and the import-boundary test: no connector source
  imports the `@workspace/db` root, only its side-effect-free `contracts`
  subpath).
- Zero new npm dependencies. `pg` and `@types/pg` were already in the lockfile;
  the connectors package reuses them and the internal workspace packages.
- The long-dash sweep is zero: the source guard passes and a database sweep over
  the seeded `connectors` catalogue returns zero em-dash and en-dash hits.

### Milestone

Phase H is a milestone hard-stop. Execution pauses here for owner review before
Phase I. Do not auto-advance.
