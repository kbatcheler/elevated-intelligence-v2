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

## Phase I: Connected mode, the in-client edge agent, and the runtime no-write guard

This phase wires the connected data pipeline (Tier 1 in full): connected-mode
grounding into the cortex, the connected refresh service and the shared
derive-and-discard persistence path, the per-tenant agent credential and routes,
a separate in-client edge-agent package proven over mutual TLS, and the runtime
no-write guard with the expanded import-boundary tests.

### What was built

- **Connected grounding context** (`lib/cortex/src/prompts/shared.ts`, threaded
  through the layer runners). A bounded `LayerGrounding` built from
  `derived_signals` grouped by layer: each entry carries the source connector key,
  the signal key, the numeric value, the window, and the computed-at time, and
  nothing else. It is threaded as an optional parameter into `runLayer` and all
  seven prompt builders, appended only on the connected path. The renderer prints
  derived math only; a vector signal renders as `vector[len]`, never dumped. The
  outside-in path passes no grounding, so its prompts are byte-for-byte unchanged
  (proven by test).
- **The connected refresh service and the shared persistence path**
  (`artifacts/api-server/src/lib/connectors/`). `connectedRefresh.ts` loads a
  tenant's connected connections, skips edge connectors (the agent owns those),
  reports a boundary-but-unimplemented connector honestly as "available, not
  connected", opens a `connector_runs` row, runs the guarded extraction in process,
  and then persists only in the caller. `persistSignals.ts` resolves a connection's
  layers from the descriptor, computes a root hash over the source, tenant, and
  signal tuples, asserts the set, checks the tenant and source match, fans each
  signal across the connector's layers, and does a delete-prior then insert in one
  transaction so a refresh supersedes the prior derived signals ephemerally.
  Persistence never lives inside a connector.
- **The dataMode branch and the connected refresh route** (the `lib/cortex`
  orchestrator). `seedTenant` branches on `tenant.dataMode` after a single lookup.
  Connected mode is refresh-only for an existing tenant: it loads the
  `ProfileOutput` from `tenant_profile` and fails loudly if it is absent or
  invalid, refreshes the connectors, builds a per-layer `LayerGrounding` from
  `derived_signals`, and runs the same shared `runLayers` helper with no homepage
  or profile stage. Outside-in mode passes no grounding through that same helper, so
  its prompts stay identical. The existing refresh route is now connected-aware with
  no new route.
- **The agent routes and per-tenant credential auth**
  (`artifacts/api-server/src/routes/agent.ts` and middleware). A new `edge_agents`
  table holds a per-tenant agent credential, storing a scrypt hash of the secret
  only with an active or revoked status. The agent router is mounted at
  `/api/agent` before the session gate: register, config pull (the tenant's
  connected edge connectors, each carrying an auth-ref pointer, never a secret), and
  signal ingest (assert derive-and-discard, check the tenant match, require a
  connected edge connector, then persist through the shared path). `requireAgent`
  verifies the bearer credential and reloads the row on every call so a revoke is
  immediate; it never reads a proxy mTLS or client-certificate header.
  Provider-only provisioning (issue, list, revoke; the token is shown once) lives on
  the tenants routes.
- **The in-client edge agent** (`artifacts/edge-agent`, a new workspace package).
  It imports `@workspace/connectors` only, plus Node built-ins, and added zero npm
  packages. It registers, pulls its config, runs only `deployment: "edge"`
  connectors, and posts a `DerivedSignalSet`. The transport runs over `node:http`
  and `node:https` with the bearer credential on every call and a client
  certificate for mutual TLS; the base URL is required to be HTTPS unless it is a
  loopback host or an explicit test opt-out, so the bearer is never sent in clear.
  Secrets are resolved from the agent's own local environment with an HMAC tokenizer
  whose salt stays on the client. A declared-but-unimplemented connector is reported
  honestly, not faked. A Dockerfile runs the agent as a non-root user with a
  documented read-only filesystem and a one-command build.
- **The runtime no-write guard and the expanded boundary tests**
  (`lib/connectors/src/guardedExtractSignals.ts`). Every extraction, in both the
  boundary refresh and the edge agent, runs inside a guard that installs a
  filesystem-write tripwire for the duration of the call and asserts the result
  through `assertDerivedSignalSet` before the caller persists. The static
  import-boundary tests are extended: a connector implementation may not import a
  filesystem or subprocess capability, and the edge-agent graph may import only
  `@workspace/connectors`, Node built-ins, and relative paths, never the db root. A
  connector that tries to write to disk during extraction fails the run and writes
  nothing (proven by test).

### Implemented versus declared

- No edge connector is implemented yet; every edge connector renders as "available,
  not connected". The edge-agent runner is proven end to end with an injected stub
  connector over a real mutual-TLS loopback, which exercises the real transport,
  handshake, and ingest path without faking telemetry. The two
  bring-your-own-warehouse boundary connectors (`generic-sql`, `redshift`) from
  Phase H remain the implemented reference extraction path.

### The mutual-TLS trust model, stated honestly

- The agent proves mutual TLS over a loopback server that requires a client
  certificate. In production an mTLS-terminating proxy sits in front of Express; the
  server's trust root is the per-tenant bearer credential, and it never trusts a
  proxy-injected client-certificate header. This is documented in the agent entry
  point and the Dockerfile. The loopback test drives the exact agent transport
  through a full handshake and proves a client with no certificate is rejected at the
  handshake.

### The runtime guard, stated honestly

- ESM named and namespace imports of `node:fs` are read-only bindings and cannot be
  monkey-patched, and a patch of the CommonJS `require("node:fs")` object is not
  observed by ESM imports. So the runtime tripwire catches require-based ambient
  writes only; the primary guarantee that the extraction path cannot touch the
  filesystem is the static import-boundary test, which forbids the connector and
  edge-agent source from importing `node:fs` at all and so also catches a dynamic
  `import("node:fs")` by string. The guard is a defense-in-depth tripwire, not a
  sandbox, and it is documented as such.

### Subprocessor list

- Unchanged. In connected mode the external model seats receive only the
  de-identified, aggregated `DerivedSignalSet`, never raw client records. The edge
  agent keeps raw client data inside the client network and posts only computed
  math. No hosted-aggregator subprocessor is introduced.

### Measured latency

- The connected refresh path (load connections, run the guarded extraction, persist
  the derived signals, close the run) completes well under a second per connector in
  the test suite against a real Postgres-wire warehouse. As in Phase H, the spec's
  connected-refresh latency tradeoff is dominated by the later layer reasoning, not
  by extraction or persistence.

### Verification

- Typecheck, build, and the full suite are green. Test totals: connectors 27, cortex
  55, db 8, scripts 4, api-server 96, edge-agent 10, portal 108.
- The outside-in regression is byte-for-byte unchanged: the grounding regression
  test proves the no-grounding prompts are identical to the prior build.
- Zero new npm dependencies. The edge-agent package reuses the workspace packages
  and Node built-ins; install added only the workspace importer.
- The long-dash sweep is zero across source (the guard) and data (a row-cast sweep
  over all 22 public tables returns zero em-dash and en-dash hits).

### Milestone

Phase I is a milestone hard-stop. Execution pauses here for owner review before Tier
2 (the split extraction and synthesis pipeline), Tier 3, and the portal
connected-mode screens. Do not auto-advance.
