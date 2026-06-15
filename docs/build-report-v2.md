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

## Phase J: The split pipeline (Tier 2, the Lens in-boundary)

### What was built

- **The extraction-zone seam** (`lib/cortex/src/stages/extractionZone.ts`). A
  type-only contract: `ExtractionRequest`, `ExtractionResult`,
  `ExtractionZoneRuntime` (a single `callJson` plus a readable `model` and
  `endpoint` for telemetry, never a secret), and a per-run `StageContext`
  (`dataMode` plus an optional `extractionRuntime`) with a `DEFAULT_STAGE_CONTEXT`
  of outside_in. The cortex depends only on this interface. The module is the
  documented TEE seam: a future confidential-computing runner that runs the same
  call inside a trusted execution environment, with attestation, implements this
  interface and drops in with no change to any stage or the orchestrator.
- **The in-boundary adapter** (`lib/cortex/src/clients/local.ts`). `callLocalJson`
  posts to an OpenAI-compatible `/v1/chat/completions` endpoint over the Node global
  `fetch` (the de-facto interface every self-hosted server speaks: vLLM, Ollama,
  TGI, llama.cpp), so no dependency is added. It requests strict JSON mode, sends a
  Bearer token only when an api key is configured, honours a 429 Retry-After across
  sub-attempts, and runs one self-correcting retry that feeds the model its own
  rejected output and the schema error. There is no web-search or tool option by
  construction: the in-boundary Lens grounds on the client's own derived signals,
  not the public web. `HttpExtractionRuntime` wraps it as the default
  `ExtractionZoneRuntime`; `getExtractionRuntime(env)` returns it when a local model
  is configured and null otherwise.
- **The local seat resolver** (`lib/cortex/src/config.ts`). A fourth provider,
  `local`, plus `resolveLocalSeat(env)` reading `LOCAL_MODEL_BASE_URL`,
  `LOCAL_MODEL_MODEL`, and an optional `LOCAL_MODEL_API_KEY`, returning null when
  unconfigured. The seat's model is supplied at runtime, never a literal in source,
  so the no-literal-model-string invariant still holds and `SEATS` stays the three
  external seats. `CortexDataMode`, `IN_BOUNDARY_STAGES` (perceive, hypothesise),
  and `runsInBoundary(stage, dataMode)` name the split.
- **The Lens routing** (`lib/cortex/src/stages/runners.ts`). `runPerceive` and
  `runHypothesise` gained a trailing `StageContext` defaulting to outside_in. When
  `runsInBoundary` is true they call `runLocalStage`, which uses the injected
  runtime (tests and the future TEE runner) or the configured local runtime; when
  none is configured it fails loud with "available, not connected" and never falls
  back to an external provider. Telemetry records the local model that actually ran.
  Every other runner and the outside_in path are untouched.
- **The orchestrator thread**
  (`artifacts/api-server/src/lib/pipeline/orchestrator.ts`). `runLayer` and
  `runLayers` carry a `dataMode` (default outside_in) and build the `StageContext`
  for the two Lens stages only. `seedConnectedTenant` passes "connected"; the
  outside_in seed passes nothing and is unchanged.

### What runs where

- In connected mode the two Lens stages (perceive, hypothesise) run in-boundary on
  the local seat. The external Synthesist (narrate), the adversarial seats (confound,
  challenge), and the Evaluator and Enrichment (score, hero, peers, supplements) stay
  on their external models and receive only the profile, the in-boundary Lens output,
  and the math-only derived-signal grounding, never raw client content.
- In outside_in mode every stage runs externally exactly as before. The split is a
  no-op on that path.

### The TEE seam, stated honestly

- The TEE is not built. The seam is: the cortex calls `ExtractionZoneRuntime`, and
  the only implementation today is a plain HTTP adapter to a self-hosted model. The
  in-boundary guarantee in this phase is deployment-topological (the model runs on
  infrastructure the operator controls), not yet cryptographically attested. A later
  confidential-computing runner implements the same interface, with hardware
  attestation that only approved code touched the data, and is dropped in with no
  change to any stage or the orchestrator. That single seam is the deliverable.
- The local model endpoint is a trusted deployment target. The adapter never logs an
  upstream error body (a local server could echo the sensitive prompt) and never
  exposes the api key through the seam. The expected deployment is a loopback,
  private-network, or operator-controlled HTTPS endpoint; a misconfigured public
  endpoint would be an operator error, not a code path.

### Subprocessor list

- Unchanged in shape, narrowed in connected mode. With the local seat configured,
  the most sensitive interpretation steps (the Lens) run inside the boundary, and the
  external model subprocessors see only de-identified, already-derived signals and
  the Lens output. No new hosted subprocessor is introduced.

### Verification

- Typecheck and build are green across the workspace. The full suite is green; cortex
  is 66 (new this phase: the in-boundary adapter proven against a real `node:http`
  server, and the split-routing tests with an injected runtime), api-server 96.
- outside_in is unchanged: the grounding regression test still proves the
  no-grounding prompts are byte-for-byte identical, and the split routers take the
  external path unchanged when dataMode is outside_in (proven by a test that the
  local runtime is never consulted in outside_in mode).
- Fail-loud honesty: an unconfigured connected Lens returns "available, not
  connected" with no silent external fallback, proven by test.
- Zero new npm dependencies (workspace packages, Node built-ins, and the global fetch
  only).
- Long-dash sweep zero across source (the guard) and data (a row-cast sweep over all
  22 public tables returns zero em-dash and en-dash hits).

### Gate

Phase J is not a milestone, but the protocol gates every phase. Execution pauses here
for owner confirmation before Tier 3 (Phase K) and the portal connected-mode screens
(Phase L). Do not auto-advance.

## Phase K: Tier 3, per-tenant cryptographic isolation, no standing access, and the hash-chained provenance ledger

Tier 3 is the SOC 2 hardening tier and a milestone. It is backend only: the portal
surfaces (security posture, break-glass screen, connections screen, provenance panel)
are Phase L and are not built here. Every acceptance item is proven by test, not by
UI. Three capabilities land: per-tenant cryptographic isolation with crypto-shredding
on key revocation, no standing human access to raw signals with an owner-approved
break-glass grant, and the provenance ledger upgraded to an append-only hash chain.
This phase added zero npm dependencies (node:crypto, the pg already in the lockfile,
and workspace packages only) and contains no em-dash or en-dash.

### What was built

- **The KMS seam** (`artifacts/api-server/src/lib/security/kms.ts`). A `KmsRuntime`
  interface (`provisionTenantKey`, `wrapDek`, `unwrapDek`, `destroyKey`, `status`)
  with a local implementation and a swappable cloud/customer adapter. The local
  runtime holds one random 32-byte key-encryption key (KEK) per tenant and wraps and
  unwraps per-row data-encryption keys (DEKs) with AES-256-GCM under that KEK. Key
  material is never logged. The cloud/customer adapter reports "available, not
  connected" until a customer-managed key is configured, so the seam is honest about
  what is and is not wired.
- **Envelope encryption** (`artifacts/api-server/src/lib/security/signalCrypto.ts`).
  Each signal value is sealed with a fresh random DEK under AES-256-GCM; the stored
  envelope is `{v, alg, keyRef, iv, tag, ct, wrappedDek}` written inside the existing
  `derived_signals.value` jsonb, so no schema column churn was needed. `isEnvelope`
  guards the shape. Plaintext, ciphertext, and keys are never logged. Typed errors
  `CryptoShreddedError` and `SignalEncryptionError` make every failure loud.
- **Persist and machine read** (the connected persist path plus the machine-grounding
  read). The plaintext `DerivedSignalSet` is validated first (the guard is unchanged),
  an active tenant key is required for connected tenants, and each value is encrypted
  before insert; the derived-set root hash is still computed over the plaintext math.
  The in-boundary machine-grounding read decrypts for the pipeline only and is a
  separate service API, not a middleware bypass. Both reads require an active
  `tenant_keys` row before decrypting any stored signal and verify that each envelope's
  `keyRef` matches that active key, so a missing key, or an envelope sealed under a
  different key, is refused rather than trusted on its own embedded reference. A revoked
  or missing KEK, a keyRef mismatch, or a legacy-plaintext row, raises a typed failure;
  the orchestrator records a loud layer failure rather than grounding on empty data.
- **Tenant key lifecycle** (`tenantKeyService.ts` plus owner-only routes). Provision
  creates and activates a tenant key; status reads provisioned/active/revoked plus the
  KMS provider; revoke destroys the KEK material first and only then commits
  `tenant_keys.status` as revoked and stamps `revokedAt`, so the system never reports a
  revoked key while its material still exists (a failed destroy throws before any status
  change), and the revocation is emitted as a structured log line. Signal rows are not
  deleted: the ciphertext is left inert and the key is what dies.
- **Break-glass, no standing access** (`breakGlass.ts`, `signalRead.ts`, and the new
  `access_grant_events` table). A human raw-signal read requires tenant access plus an
  active, unexpired, unrevoked grant for every role, owners included; each access
  appends an event row tied to the grant and the user. The pipeline machine read stays
  exempt through its own separate service API, never a relaxation of the guard.
- **The provenance ledger** (`artifacts/api-server/src/lib/provenance/ledger.ts`). An
  append-only per-tenant hash chain exposing only `appendEntry` and `verifyChain` (no
  update, no delete). Appends serialize on a Postgres transaction-scoped advisory lock
  per tenant; `contentHash = sha256(canonical({tenantId, claimPath, sourceRef,
  prevHash}))` and `prevHash` is the prior entry content hash. The orchestrator writes
  entries after the layer is verified and modelled, over source and provenance
  references only, never raw client data.

### Implemented versus declared (the customer-managed-key boundary)

- The local KMS is fully implemented and is the default. It is a software key store,
  not a hardware security module: it provides per-tenant key isolation and genuine
  crypto-shredding (destroying one tenant KEK permanently unwraps that tenant's DEKs
  and nothing else), but the keys live in operator-controlled storage rather than in
  dedicated key hardware. Specifically the KEK material sits in the same Postgres
  database as the ciphertext it protects (`kms_local_keys` alongside `derived_signals`).
  The shred is real for the live store, but co-location means it does not defend against
  a database-admin compromise, nor against a backup or snapshot taken before revocation
  that captures both KEK and ciphertext. A customer-managed KMS, where the KEK never
  enters our database, is the boundary that closes that gap.
- The customer-managed-key (CMK) path is declared and stubbed honestly. Until a
  customer key is configured the cloud/customer adapter status reads "available, not
  connected"; it never fabricates a wrap or a status. A real cloud KMS or a true
  bring-your-own-key arrangement implements the same `KmsRuntime` interface and drops
  in with no change to the envelope format or the call sites.

### Crypto-shred evidence

- Revoking a tenant key destroys the KEK and leaves the encrypted rows in place. A
  subsequent human read of that tenant's raw signals fails with a typed
  `crypto_shredded` error even under a valid break-glass grant, and the machine read
  fails loud the same way. This is proven end to end by the security integration test:
  provision and seal signals, revoke the key, then assert the read returns
  `crypto_shredded` rather than any plaintext. The data is unreadable because the only
  key that could unwrap it no longer exists.

### Database-level append-only intent

- The provenance ledger is append-only by service contract: the module exports only
  `appendEntry` and `verifyChain`, with no update or delete path, and the chain links
  each entry to its predecessor by content hash so any in-place edit, reorder, or
  deletion breaks `verifyChain`. The integrity guarantee is the hash chain plus the
  serialized append, verifiable at any time; database-role-level append-only
  enforcement (revoking UPDATE and DELETE on the table) is a deployment-time hardening
  left for the operator and does not change the application contract.

### Subprocessor list

- Unchanged in shape. Tier 3 adds no new hosted subprocessor: the local KMS, the
  envelope encryption, the break-glass ledger, and the provenance chain all run inside
  the application and Postgres the operator already controls. A future customer-managed
  KMS would introduce the customer's own key service as a subprocessor under the same
  interface; today it is "available, not connected".

### Verification

- Typecheck and build are green across the workspace. The full suite is green: 123
  tests across 15 files (up from 96), with 27 new tests this phase: envelope crypto
  round-trip, wrong/missing-key, keyRef-mismatch, and legacy-plaintext typed errors, and
  GCM tamper detection (`signalCrypto.test.ts`); the revoke failure-injection and
  crypto-shred lifecycle (`tenantKeyService.integration.test.ts`); chain order, tamper
  detection, the append-only
  surface, and verifyChain on clean and corrupted chains (`provenance/ledger.test.ts`);
  and the HTTP security surface end to end (`routes/security.integration.test.ts`):
  owner-only key lifecycle, no standing access for any role, grant enables read and
  every access is logged, expiry and revoke both deny, owner-only provenance verify,
  and the crypto-shred read failure.
- Acceptance is proven by test, not by UI, as the phase requires. The portal has no
  Tier 3 surface yet (Phase L), so the Playwright testing skill, which is for UI flows
  and explicitly not for API-only verification, is not applicable here; the unit and
  integration suites are the acceptance evidence.
- outside_in is unchanged: outside_in tenants have no derived signals, no tenant key,
  and no encryption, and the grounding regression test still proves the no-grounding
  prompts are byte-for-byte identical.
- Fail-loud honesty: a revoked or missing key, a legacy-plaintext row, a missing or
  expired or revoked break-glass grant, and an unconfigured customer KMS all surface
  as typed errors or an "available, not connected" status, never a silent empty result
  or a fabricated value.
- Zero new npm dependencies (node:crypto, the pg already in the lockfile, the global
  fetch, and workspace packages only).
- Long-dash sweep zero across source (the guard over lib, artifacts, docs, and
  scripts) and data (a row-cast sweep over all 24 public tables, which now includes
  `kms_local_keys` and `access_grant_events`, returns zero em-dash and en-dash hits).

### Milestone

Phase K is a milestone hard-stop. Execution pauses here for owner review before Phase
L (the portal connected-mode and security screens). Do not auto-advance.

## Phase L: the portal security surfaces over Tier 3

Phase L is the portal over the Phase K Tier 3 backend, changing no Tier 3 guarantee.
It adds four surfaces: an owner-only security console (key lifecycle posture,
connection-security posture, break-glass administration, and provenance verification)
and a separate all-role human signal read page. Every panel renders only real backend
facts with designed loading, empty, and error states, never a fabricated value or a
silent spinner. Zero new npm dependencies; no em-dash or en-dash.

### What it surfaces

- **Security posture.** The tenant key status (active, revoked, or not provisioned),
  the active KMS provider and connected state, and the customer-managed KMS shown as
  "available, not connected", with owner provision and revoke actions. A revoked key
  reads as revoked, not as missing data.
- **Connection-security posture.** The connection's protection facts only (key status
  and KMS). The existing `/connections` feeds page is left intact and untouched; this
  is a distinct security view, not a replacement.
- **Break-glass administration and the access audit.** Owners create time-boxed grants
  (the user picker reuses the owner-only `GET /api/admin/users`), see every grant with
  its live state distinguished as active versus expired versus revoked, revoke an
  active grant, and read the append-only access-event audit of every read made under a
  grant.
- **The all-role human signal read.** A separate page, deliberately not owner-only
  because the `GET .../signals` endpoint gates on an active grant for every role rather
  than on ownership. It reads the decrypted human signals for the current tenant under
  an active grant, mapping each Tier 3 refusal (grant required, crypto-shredded,
  unreadable), the empty case, and the ready case to its own honest state. Decrypted
  values are rendered exactly as the math produced them and are never cached or
  exported.
- **Provenance verification.** The per-tenant chain verify result, reported as intact
  or broken with the chain length, the broken index, and detail.

### The data layer

- `artifacts/portal/src/lib/securityApi.ts` is a framework-free client mirroring
  `adminApi.ts`: typed outcomes for every call, a 401 mapped to an unauthorized signal
  so the shell logs the seat out, and the three Tier 3 failure codes mapped to their
  own honest UI states by branching on the response body's error code
  (`break_glass_required` -> 403, `crypto_shredded` -> 409, `signal_unreadable` ->
  422), never an empty list. A fetch error is always a distinct outcome from an empty
  result.

### Minimal backend addition

- `GET /api/security/tenants/:id/key` now also returns `customerKms` from
  `customerKmsStatus()`, so the posture view shows the declared customer-managed-KMS
  seam ("available, not connected") without the UI inventing it. A route test asserts
  the field is present and honest. No other endpoint was added.

### Verification

- Typecheck and build are green across the workspace. The full suite is green: 382
  tests (portal 144, up from 108 with 36 new in `securityApi.test.ts`; api-server 123;
  cortex 66; connectors 27; edge-agent 10; db 8; scripts 4). The new portal tests
  exercise every securityApi helper (URL, method, body), the ready, empty, and error
  outcomes, the 401 unauthorized path, the `no_key_to_revoke` case, the three typed
  Tier 3 codes, and the verify payload.
- e2e acceptance with the Playwright testing skill: signed in as a seeded provider-
  owner and verified the security console header and all four tabs render honest non-
  loading states, then verified the all-role human signal read shows exactly one honest
  state (break-glass grant required, as expected with no active grant), never a spinner
  and never a fabricated value.
- Fail-loud honesty: a revoked or missing key, a missing or expired or revoked grant,
  a crypto-shredded or unreadable read, and an unconfigured customer KMS all surface as
  their own designed state, never a silent empty result or a fabricated value.
- Zero new npm dependencies; the long-dash sweep is zero across the Phase L source.

### Gate

Phase L is gated. Execution pauses here for owner review before the next phase. Do not
auto-advance.

## Phase M: full verification of the connector and SOC 2 stage, and this append

Phase M is the closing gate of the connector and SOC 2 stage (Phases H through L). It
builds no product feature and changed no product code: it verifies the stage against
Part 8 of the addendum and writes this consolidated append, which Part 8 item 11
requires. The per-phase sections above hold the detail; this section gathers the seven
elements item 11 asks to put on record. Zero new npm dependencies; no em-dash or
en-dash.

### The connector framework

A single internal workspace package, `lib/connectors`, defines one uniform connector
contract with a capability-minimal context (resolveSecret, tokenize, now, log; no
database handle and no filesystem). Every extraction returns a `DerivedSignalSet`, the
math-only contract that carries scores, ratios, distributions, counts, aggregates,
trend deltas, and non-reversible embeddings, and nothing reversible into a person or
account. A Zod schema plus the runtime guard (`assertDerivedSignalSet`) reject any
out-of-shape or raw value, and `guardedExtractSignals` wraps every run with the
no-write tripwire. The connector path imports only `@workspace/db/contracts`, never the
db root, so it never holds a handle to our store and can run inside the in-client edge
agent; a static import-boundary test enforces this.

### The catalogue, implemented versus declared

The catalogue is the full 46 connectors across all ten Part 1 families, seeded
idempotently into the `connectors` table. Two connectors are implemented and run end to
end: `generic-sql` and `redshift`, both in the bring-your-own-warehouse family, proven
against a real PostgreSQL-wire warehouse through the derive-and-discard path (a
structured, parameterized, aggregate-only measure DSL with no free-form SQL, a
read-only transaction, numeric-only columns, every return guarded). The other 44
connectors across the remaining nine families are declared with correct layer and
signal mapping but have no runtime; the registry returns an honest "available, not
connected" for them and the connected refresh rejects them rather than faking data.
This is the staged design: the Part 8 "at least two per family run end to end" is the
end-state acceptance for the later connector phases, and the remaining families stay
declared because their drivers would be new dependencies, held off under the
zero-new-dependency rule.

### The new tables and routes

- Tables added across the stage: `connectors`, `tenant_connections`, `connector_runs`,
  `derived_signals`, `provenance_ledger`, `tenant_keys` (Phase H, Part 4 schema);
  `edge_agents` (Phase I); `kms_local_keys` and `access_grant_events` (Phase K); plus a
  `tenants.dataMode` column. The signal envelope is stored inside the existing
  `derived_signals.value` jsonb, so Tier 3 added no ciphertext columns.
- Routes added across the stage: the tenant-scoped, bearer-gated `/api/agent` register,
  config-pull, and signal-ingest routes (Phase I); the owner-only security routes for
  the tenant key lifecycle (provision, status, revoke), break-glass grant
  administration (create, list, revoke) plus the access-event audit, the all-role human
  signal read that gates on an active grant, and the provenance verify route (Phase K),
  with the key-status route extended to also return `customerKms` (Phase L).

### The split-pipeline change to the cortex

Tier 2 (Phase J) splits the cortex by sensitivity. In connected data mode the two Lens
stages (perceive, hypothesise) run in-boundary on a local model seat through one narrow
seam (`ExtractionZoneRuntime`), because the Lens is where the client's own signals are
first interpreted. The external Synthesist (narrate, Claude) and the adversarial seats
(confound and challenge, Gemini) plus the Evaluator and enrichment stay on their
external models and receive only the profile, the in-boundary Lens output, and the
math-only derived-signal grounding, never raw client content. The split is a no-op in
outside_in mode, which is byte-for-byte unchanged. An unconfigured connected Lens fails
loud with "available, not connected" rather than silently sending the sensitive stages
to an external provider.

### Subprocessor list

The external model providers are the only data subprocessors: Anthropic backs the
Anthropic-hosted seats (the profile build, the Synthesist that narrates, the Evaluator
and enrichment, and on the outside_in path the Lens stages), and Gemini backs the
adversarial Confounder and Challenger seats. In connected mode they receive only the
de-identified, aggregated derived signals and the in-boundary Lens output, so raw client
records never transit a third party. The warehouse connectors run inside the
deployment boundary against the client's own warehouse; the local KMS, the envelope
encryption, the break-glass ledger, the provenance chain, and the edge-agent runtime all
run inside the application and the Postgres the operator already controls, so they add no
new hosted subprocessor. A future customer-managed KMS would introduce the customer's own
key service as a subprocessor under the same interface; today it reads "available, not
connected".

### The measured connected-refresh time

Measured on the real path, not the stubbed integration test: the `generic-sql`
warehouse connector run through `refreshConnectedTenant` against a real PostgreSQL-wire
warehouse (the local Postgres reached as a warehouse over DATABASE_URL), with a
disposable 5,000-row table and four aggregate-only measures. One warmup run was
discarded, then three timed runs were taken, and the temporary tenant and table were
deleted after.

- Per run: 51.2 ms, 60.9 ms, 67.6 ms. Median 60.9 ms, range 51.2 to 67.6 ms.
- Each run extracted four measures, fanned them across the fourteen layers the connector
  feeds (56 `derived_signals` rows), sealed every value in its own AES-256-GCM envelope
  under the tenant key, and stamped a provenance root; all 56 stored values were verified
  to be encrypted envelopes, not plaintext.
- This is a local Postgres-wire measurement of the in-boundary extract, derive, encrypt,
  and persist floor. It is not client wide-area-network latency: a real client warehouse
  over a network link adds round-trip and query time on top. The number records the
  in-boundary processing cost connected mode adds over outside_in, which has no extraction
  and no encryption.

### Verification

- Typecheck and build are green across the workspace (exit 0 on both). The full suite is
  green: 382 tests (api-server 123, portal 144, cortex 66, connectors 27, edge-agent 10,
  db 8, scripts 4). No new tests were added this phase; the suite is the standing
  acceptance evidence for the Part 8 behavioural items and the regression contract.
- All eleven Part 8 items were checked. Nine are met; item 2 is partial (the catalogue is
  complete and honest, but only the warehouse family has two connectors that run end to
  end) and item 9 is met with a logged residual (append-only is application-layer plus the
  hash chain plus the UI verify; database-role-level write blocking is a deployment-time
  hardening that is not in place). Both are stated honestly here and in `phase-M.md`,
  never rubber-stamped.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, and
  scripts, and a row-cast sweep over all 24 public tables.

### Gate

Phase M is gated and closes the connector and SOC 2 stage. Execution pauses here for
owner review before the next stage. Do not auto-advance.

## Phase N: cost and token observability

Phase N opens Stage 3 (operations and economics). It puts a real cost on every model
call the system makes, exposes that cost to the owner, and caps it. The single rule is
that the ledger never fabricates: a dollar figure exists only because a real provider
call billed real tokens, and a call that made no request bills nothing. Zero new npm
dependencies; no em-dash or en-dash.

### What Phase N built

A new `model_usage` ledger records one row per real billed model call. A cortex pricing
module turns the call's real token counts into dollars. A best-effort usage writer taps
the orchestrator (the sole side-effect owner) to insert exactly one row per real call. A
budget governor reads the ledger and enforces env-backed monthly caps before a seed
spends. An owner-only Spend console renders the ledger with honest loading, empty, and
error states.

### The cost model and pricing honesty

Pricing lives in one place (`lib/cortex/src/pricing.ts`), the only place token counts
become dollars. The rates are published list-price defaults expressed in USD per
1,000,000 tokens and per web-search call: the reasoner seat at 3 in / 15 out, the
evaluator seat at 1 in / 5 out, the grounder seat at 1.25 in / 10 out, prompt-cache reads
and writes at their published multiples of input, and a web-search tool call at 0.01.
They are keyed by the three cortex seats, never by a literal model string, so the
no-model-literal config invariant holds; a reported model string is resolved back to its
seat through `SEATS`. A self-hosted or unrecognised model prices at zero because it
incurs no external per-token charge. These are list prices the operator must verify
against their own contract, stated as such in the module and the console; negotiated or
volume pricing will differ. `costUsdForUsage` prices each token bucket at its rate plus
the web-search calls and rounds to the six decimals of the ledger column; a missing count
is treated as zero, never guessed.

### The billed signal, so the ledger never fabricates a row

A model call can fail two ways and only one costs money. A no-call failure (no
in-boundary model configured, a provider integration with no env, or a transport failure
before any response) spent nothing and must record nothing. A billed failure (a 200 that
billed real tokens and then failed our own schema validation) spent the money and must be
recorded at the real cost even though the stage failed. An explicit `billed` flag travels
on the stage telemetry to tell the two apart: it means a real token-billed response
occurred. The usage writer records a row only when `billed` is true and a model is
present, so a no-call failure produces no row and the ledger holds no fabricated
zero-cost line. Each client also sums token usage across its two-attempt corrective retry,
so a billed-then-retried attempt counts once with the summed tokens, never dropped and
never double-counted. The orchestrator taps usage in exactly three places (the stage run
on both the ok and error path, the enrichment as a single row rather than the batched
folded peers, and the profile build after the tenant is ensured), and resume paths return
before the tap, so a resumed run records no duplicate.

### The new table, route, and env

- Table: `model_usage`, one row per real billed call, with the tenant (nullable, set null
  on delete so cost history survives), the run id (nullable, no foreign key), stage, layer
  key, seat, the reported model string, the token buckets, the web-search call count, the
  `numeric(12,6)` cost, and the created-at; indexed on tenant and created-at.
- Route: owner-only `GET /api/spend/summary`, returning the month, the totals, and the
  breakdowns by tenant, seat, stage, run, and day, plus the caps and threshold; the
  `numeric` cost is returned as a JS number. Member is 403, unauthenticated is 401.
- Env: `SPEND_GLOBAL_MONTHLY_CAP_USD` (default 1000), `SPEND_TENANT_MONTHLY_CAP_USD`
  (default 50), and `SPEND_ALERT_THRESHOLD` (default 0.8). The governor refuses a new seed
  once a ceiling is reached and warns between the threshold and the ceiling; the owner-only
  `priorityOverride` bypasses the global ceiling only, never the per-tenant ceiling.
  Enforced in the seed and refresh routes with a clear typed HTTP error and again
  defensively in the seed path before any model spend.

### Subprocessor note

Phase N adds no new data subprocessor. The cost ledger, the pricing math, the budget
governor, and the spend console all run inside the application and the Postgres the
operator already controls. The external model providers (Anthropic and Gemini) are
unchanged from the connector stage; Phase N only counts and prices the calls already made
to them.

### Verification

- Typecheck and build are green across the workspace (exit 0 on both). The full suite is
  green at 417 tests (api-server 139, portal 149, cortex 80, connectors 27, edge-agent 10,
  db 8, scripts 4); new this phase are the cortex pricing and billed-token tests, the
  api-server budget and spend-summary integration tests, and the portal spend-api tests.
- The spend summary reconciles to a direct `SUM` over `model_usage`; the usage tests prove
  the one-row invariant, that a no-call failure records nothing, that a billed-but-failed
  call records at the real cost, and that the corrective retry sums tokens.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, and
  scripts, and a per-row cast over the `model_usage` ledger and the run telemetry.

### Gate

Phase N is gated and opens Stage 3. Execution pauses here for owner review before the next
phase. Do not auto-advance.

## Phase O: connector operational reality

The connector stage (Phases H through L) built the clean extraction path. Phase O builds
the unhappy path that production actually is: OAuth tokens expire, client APIs throttle,
connections go stale and die, and an operator must be told. It adds an OAuth refresh
scheduler, a per-connection token-bucket rate limiter, a read-time connector health
derivation surfaced in the Connections and Security posture views, incremental-extraction
cursor plumbing that persists only the watermark, and an alert SEAM that records each
operational event for the Phase P notifier to consume. Nothing is fabricated: there is no
live OAuth runtime and no incremental-capable connector yet, so both are shipped as honest,
tested seams that report "available, not connected" rather than faking a renewal or an
incremental number. Zero new npm dependencies; no em-dash or en-dash.

### The alert SEAM

Every operational event an operator must know about is emitted through one `Alerter`
interface with a single `emit(event)` method. The default `DbAlerter` records one pending
row in the new `alert_events` table and then logs only the routing fields (type, severity,
ids), never the message body or the details. The `AlertEvent` details payload is scalars
only by construction, so an emitter cannot accidentally attach a secret object or a raw
client record. Consumers depend on the interface, never on a sink, so the Phase P notifier
that consumes the pending rows wires in without touching any emitter. The type enum already
declares all six alert kinds (the two Phase O emits, `connector_error_transition` and
`oauth_refresh_failed`, plus the four Phase P will fire), so the notifier needs no enum
migration.

### OAuth token refresh

`runDueOAuthRefreshes` selects connected connections that carry a recorded token expiry,
keeps only the oauth2 descriptors, and renews each one at or inside its per-connector
`oauthRefreshLeadSeconds` window. A success writes the new expiry and clears any prior
error, rotating the stored credential reference when the provider rotates it. A failure
flips the connection to error with `last_error_code = reauthentication_required`, records
the reason, and emits a critical `oauth_refresh_failed` alert. There is no oauth2 connector
runtime in the system, so the default `NotImplementedTokenRefresher` rejects honestly and
the scheduler is proven with an injected refresher, exactly as the edge agent and boundary
runtime are proven with injected stubs. `startConnectorMaintenance` runs the loop from the
server entrypoint only (never from app.ts, so importing the app in a test starts no timer),
never overlaps ticks, swallows a tick failure, and unrefs its timer.

### Per-connection rate limiting

`takeToken` is an in-process token bucket sized from the descriptor's `quotaProfile`
(capacity and refill rate), enforced before each extraction so we never exceed a client
API's own throttle. `runWithThrottleRetry` retries ONLY a typed `ConnectorThrottleError` (a
429 or equivalent) up to the profile's `maxAttempts`, honoring a server `Retry-After` hint
when present and otherwise backing off exponentially, capped at `maxRetryAfterSeconds` so a
hostile or oversized hint cannot stall the runtime. A genuine error propagates on the first
throw and is never retried; that distinction is the heart of the acceptance set, and it
mirrors the seed-runner 429 handling.

### Connector health, derived not stored

`deriveConnectionHealth` returns error when the connection is flipped to error, degraded
when it is connected but not currently trustworthy (never succeeded, last success older
than the staleness threshold, or an error newer than the last success), and healthy
otherwise. It is derived from the real timestamps on every read and never stored, so it
cannot drift from reality between writes, and a connection that has never run reads as
degraded rather than healthy. The owner-only `GET /api/security/tenants/:id/connector-
health` route returns it worst-first with a 24 hour staleness fallback, and a new
`ConnectorHealthSection` renders it with honest loading, empty, error, and unauthorized
states in both the Connections security panel and the Security posture panel.

### Incremental extraction, plumbed but dormant

Incremental is wired end to end: a `WatermarkValue` on the contract, a `nextWatermark`
returned alongside the derived set, the cursor passed to a connector only when its
descriptor declares support, and the watermark persisted (in the new
`tenant_connections.cursor_watermark` jsonb) only when the descriptor supports it and a
cursor came back, never the source data behind it. But every production descriptor keeps
`incremental.supported = false`, because the only connector runtimes that exist are the
bring-your-own-warehouse pair that compute whole-table aggregates, and treating a
partial-new-rows aggregate as an incremental continuation would fabricate a number. So the
cursor seam is real and tested by temporarily enabling support on a descriptor, and dormant
in production, where every refresh does the honest full derive and any returned cursor is
dropped.

### The connected-refresh integration

The Tier 1 boundary runtime now takes a bucket token before each extraction (waiting the
reported time, capped, when the bucket is momentarily empty), wraps the guarded extraction
in the throttle-retry so a throttled source backs off and recovers WITHOUT failing the run,
records `last_success_at` and resets the status to connected on success, and on a failure
flips the connection to error with a `rate_limited` or `extraction_failed` code and emits a
`connector_error_transition` alert ONLY on the transition into error, so a persistently
broken connection does not re-alert every cycle. Both alert emissions are best-effort, so a
recording failure never masks the underlying refresh failure.

### The new table, route, columns, and env

- Table: `alert_events`, the alert SEAM ledger, decoupled from the tenant lifecycle
  (tenantId nulls out on a tenant delete) with a `notification_status` the Phase P notifier
  advances.
- Route: owner-only `GET /api/security/tenants/:id/connector-health`.
- Columns: `tenant_connections` gains `last_success_at`, `token_expires_at`,
  `cursor_watermark`, `last_error_code`, `last_error_at`, and `last_error_message`.
- Env: none. The refresh lead time, staleness threshold, and quota profile are
  per-connector registry descriptor fields, not env; the maintenance interval is a code
  default (15 minutes) with an options override.

### Subprocessor note

Phase O adds no new data subprocessor. The scheduler, the rate limiter, the health
derivation, and the alert ledger all run inside the application and the Postgres the
operator already controls. The Phase P notifier may later deliver alerts to an external
sink (Slack or a generic webhook); Phase O only records them.

### Verification

- Typecheck and build are green across the workspace (exit 0 on both). The full suite is
  green at 441 tests (api-server 161, portal 149, cortex 80, connectors 29, edge-agent 10,
  db 8, scripts 4); new this phase are the rate-limiter unit tests, the connection-health
  derivation tests, the OAuth refresh integration tests, the rewritten connected-refresh
  integration tests, and the guarded-extract watermark and wrapper cases.
- The connected-refresh tests prove the three acceptance cases: a throttled source recovers
  without failing the run, a dead connection reads as error and fires exactly one
  transition alert, and an already-error connection fires no new alert. The OAuth tests
  prove a due token renews, a not-yet-due token is left alone, and a failed renewal flips
  to error with re-authentication required and a critical alert.
- Long-dash sweep zero on both sides: the source guard, and a per-row cast over every text
  and jsonb column in every public table, now including `alert_events`.

### Gate

Phase O is a per-phase gated stop, but the owner authorized an autonomous run of Phases O,
P, and Q back to back. Execution does not pause here; it proceeds to Phase P and stops for
owner review only after Phase Q.

## Phase P: observability and alerting

Phase O recorded each operational event as a pending `alert_events` row behind a one-method
alert SEAM. Phase P is the consuming half: it delivers those events to a human, aggregates
errors to an external collector, gives the owner a live operations view, and turns the
health endpoint into an honest per-dependency probe. Nothing is fabricated: there is no
Sentry project and no Slack or webhook endpoint connected, so the error reporter and the
notifier transports are honest adapters that report "available, not connected" (a no-op
reporter, a log sink) until their env is set, mirroring the KMS pattern. This phase added
zero npm dependencies and contains no em-dash or en-dash.

### The Sentry-compatible error reporter

`sentryReporter.ts` parses a standard Sentry DSN into its ingest origin, project id, and
public key with no SDK, builds a Sentry envelope by hand (event id, timestamp, level,
platform, and either a structured exception with a stack or a message), and POSTs it over
the Node global fetch with a bounded timeout. With no `SENTRY_DSN` the default is a no-op
reporter: "available, not connected", and `captureError` does nothing rather than crash at
boot. The payload is an allowlist of scalar context only (subsystem, route, level, tenant
id, run id); it never carries a request body, headers, raw connector records, or a secret.
`captureError` never throws into its caller, so an observability outage can never alter or
delay a real request.

### The pluggable alert notifier

`notifier.ts` drains pending `alert_events` rows with `FOR UPDATE SKIP LOCKED` inside a
transaction (so two drain ticks, even across instances, never deliver the same row twice),
formats each from routing fields and scalar details only, delivers it through the configured
transport, and marks the row `sent` or, on a terminal failure, `failed`. The transport is
selected from env: a Slack incoming webhook (`SLACK_WEBHOOK_URL`), a generic JSON webhook
(`ALERT_WEBHOOK_URL`), or the honest default log sink when neither is set. The drain loop
runs on an interval from the server entrypoint only (never app.ts), never overlaps ticks,
swallows a tick failure, and unrefs its timer, exactly as the Phase O maintenance loop does.

### The five emitters wired onto the seam

Phase O already emitted `connector_error_transition`. Phase P adds the rest so the notifier
delivers all required event classes: the orchestrator's `runLayer` catch emits
`seed_run_failed` and calls `captureError`; `budget.ts` emits `budget_threshold` through a
helper that dedupes by an entity id scoped to the cap kind and month, so a threshold alerts
once per scope per month rather than on every priced call; the security route emits
`break_glass_used` after the access is appended to the audit; and the provenance verify
route emits `provenance_integrity_failed` only when `verifyChain` returns `ok === false`.

### The owner Operations route

An owner-only `GET /api/operations` (behind `requireAuth` and `requireOwner`) returns, all
from real tables: the in-flight runs with their current stage, the recent failures with the
stage that failed, the live seed-queue depth read from the `pipeline_jobs` claim queue as
running and waiting counts, and the recent alert feed from `alert_events`. Every figure is a
query against persisted state; there is no synthesized metric.

### The structured health route

The health route is rewritten to return a per-dependency status object rather than a bare
"ok". The database is probed with a real round-trip, the secret store through its status
seam, and the two model providers report `configured` or `not_configured` from their env,
escalating to a live reachable check only when a deep probe is explicitly requested
(`?deep=1` or `HEALTH_DEEP_CHECK=1`), because a health endpoint must not silently bill a
model call on every poll. A dependency that cannot be probed reads `unknown`, never a
fabricated `ok`; the overall status is the honest worst-of the per-dependency states.

### The new route and env

- Route: owner-only `GET /api/operations`. The health route is the existing `GET /health`,
  rewritten to the structured per-dependency shape.
- No new table and no new column: the notifier advances the `notification_status` on the
  Phase O `alert_events` table, and Operations reads existing tables.
- Env (all optional, all honest defaults): `SENTRY_DSN`, `SENTRY_RELEASE`,
  `SENTRY_TIMEOUT_MS`; `SLACK_WEBHOOK_URL`, `ALERT_WEBHOOK_URL`, `ALERT_NOTIFIER_TIMEOUT_MS`,
  `ALERT_DRAIN_INTERVAL_MS`; `HEALTH_DEEP_CHECK`. With none set the system runs fully: no
  error aggregation, alerts to the log sink, and a configuration-based health report.

### Subprocessor note

Phase P adds no new data subprocessor by default. The error reporter and the notifier only
contact an external sink (Sentry, Slack, or a generic webhook) when the operator sets that
sink's env; the payloads carry routing metadata and scalar identifiers only, never client
data or secrets. Until then everything stays inside the application and the operator's own
Postgres.

### Verification

- Typecheck and build are green across the workspace (exit 0 on both). The full suite is
  green at 464 tests (api-server 184 across 25 files, portal 149, cortex 80, connectors 29,
  edge-agent 10, db 8, scripts 4); new this phase are the Sentry reporter unit tests, the
  notifier integration tests, the health integration tests, the operations integration
  tests, the budget threshold integration test, and a `break_glass_used` assertion added to
  the security suite.
- The acceptance cases are proven by test: a deliberately failed seed surfaces in
  Operations with its failing stage and is delivered exactly once by the notifier (the row
  flips to `sent` and a second drain delivers nothing), and the health route returns a
  per-dependency structured status with honest unprobed states.
- Long-dash sweep zero on both sides: the source guard, and a per-row cast over every text
  and jsonb column in every public table.

### Gate

Phase P is a per-phase gated stop, but the owner authorized an autonomous run of Phases O,
P, and Q back to back. Execution does not pause here; it proceeds to Phase Q and stops for
owner review only after Phase Q.

## Phase Q: secrets vault

Phase Q put a real managed backend behind the existing `SecretStore` seam and proved that
no resolved secret value is ever persisted to a table or to `.replit`. There is no managed
secret manager connected, so the GCP adapter is an honest, tested REST adapter that reports
"available, not connected" until its project is configured, exactly mirroring the KMS
pattern. This phase added zero npm dependencies and contains no em-dash or en-dash.

### The GCP Secret Manager adapter

`gcpSecretStore.ts` is a full `SecretStore` over the Secret Manager REST API with the Node
global fetch and zero SDK. Construction validates nothing, so an unset project never crashes
the boot; the first `get`/`set`/`delete` resolves the project and a token lazily and throws
a precise "available, not connected: set GCP_PROJECT_ID to connect it" error if the project
is missing. `get` reads `versions/latest:access` (404 to `null`, base64 decode), `set`
creates the container (tolerating a 409) then adds a base64 version, and `delete` tolerates
a 404 so it is idempotent. The token comes from the GCP metadata server (cached until just
before expiry) or, with `GCP_SECRET_MANAGER_TOKEN_SOURCE=env`, from
`GCP_SECRET_MANAGER_ACCESS_TOKEN`. Every ref is validated against the Secret Manager id
grammar before any network call, every request is bounded by an `AbortController` timeout
(`GCP_SECRET_MANAGER_TIMEOUT_MS`, default 5000), and no value, token, or response body is
ever logged or attached to an error (the access body is the secret itself).

### Provider selection and resolution

`getSecretStore` constructs the store `SECRET_STORE_PROVIDER` selects: unset or `env` uses
the local env-backed store (the default), `gcp` selects the REST adapter. Every secret the
application reads at runtime is resolved by name through the store, never from `process.env`
at the call site: `SESSION_SECRET` (auth middleware, auth and admin routes, the PIN pepper,
the connected-refresh token salt) through `requireSecret`, `OWNER_PASSWORD` through
`store.get` at bootstrap (only the scrypt hash is then persisted), and connector credentials
through `buildConnectorContext.resolveSecret`, which the warehouse connector uses to resolve
its `scope.authRef`. `tenant_connections` stores only the `authRef` reference, never a value.

### The KMS stays separate

`tenant_keys.kmsKeyRef` is deliberately not routed through the `SecretStore`. The KEK
material is the root of the per-tenant crypto-shred guarantee and has a different blast
radius from an API credential; it keeps its own KMS boundary (`lib/security/kms.ts`) with
its own swappable cloud/customer adapter that already reports "available, not connected".
The two seams are siblings, not a hierarchy.

### The honest adapter

With the default env-backed store, secrets resolve from the platform-injected environment,
which is the legitimate durable secret home (the platform owns durable storage). With
`SECRET_STORE_PROVIDER=gcp` but no project, the adapter constructs cleanly and the first
resolution throws the precise "available, not connected" error. `EnvSecretStore.set` and
`.delete` mutate the in-process environment only and are not durable across a restart, which
is honest by design: the durable write path is the GCP adapter, and the env store is the
local-dev default and read path, not a durable writable vault.

### The new env (no new table, no new column)

- `SECRET_STORE_PROVIDER` (unset or `env`, or `gcp`).
- GCP adapter env, all optional and lazy: `GCP_PROJECT_ID` (its absence is the
  available-not-connected error), `GCP_SECRET_MANAGER_TOKEN_SOURCE` (`metadata` or `env`),
  `GCP_SECRET_MANAGER_ACCESS_TOKEN` (only when the token source is `env`),
  `GCP_SECRET_MANAGER_ENDPOINT`, and `GCP_SECRET_MANAGER_TIMEOUT_MS` (default 5000).
- No schema change: `tenant_connections.authRef` and `tenant_keys.kmsKeyRef` are the
  existing reference columns and no value column was added.

### Verification

- Typecheck and build are green across the workspace (exit 0 on both). The full suite is
  green at 478 tests (api-server 198 across 26 files, portal 149, cortex 80, connectors 29,
  edge-agent 10, db 8, scripts 4); new this phase are the GCP adapter and provider-selection
  unit tests and the secret-resolution integration test.
- The acceptance cases are proven by test: a connection authenticates by resolving its
  `authRef` through the store, and no resolved secret value is persisted anywhere. The
  integration test resolves a unique sentinel through an injected store during a real
  refresh, then sweeps every public text and jsonb column (catalogue-driven `UNION ALL`
  count, non-empty-list guarded) and the repo-root `.replit` for the sentinel and asserts a
  total of zero.
- Long-dash sweep zero on both sides: the source guard, and a per-row cast over every text
  and jsonb column in every public table.

### Gate

Phase Q is the final phase of the owner-authorized autonomous run of O, P, and Q. Execution
stops here for owner review of all three phases.

## Phase R: expand test coverage and confirm CI

Phase R hardens the regression gate. The Operations prompt names this phase "introduce
testing", but a Vitest suite and a GitHub Actions CI workflow have existed since Phase B,
so the adaptation guide rescopes R to "expand test coverage": prove every load-bearing
invariant has a test that turns red when broken, add the one missing guard, and confirm CI
runs typecheck, build, and test and blocks on failure. Zero new npm dependencies, no
em-dash or en-dash.

### The invariant ledger

Seven of the eight load-bearing invariants were already pinned by a test that asserts the
failing case: the DerivedSignalSet guard rejecting raw records
(`lib/db/src/contracts/derivedSignalSet.test.ts`); the connector and edge-agent extraction
path holding no db handle and no `node:fs` (the two `importBoundary.test.ts` files); the
four PIN failure modes returning one byte-identical error with a valid PIN succeeding and
decrementing exactly once, plus requireOwner refusing a member and admitting an owner (the
auth integration suite); the session cookie verifying valid and rejecting tampered and
expired (`session.test.ts`); the provenance ledger append-only with a broken chain detected
(`ledger.test.ts`); and the long-dash guard scanning authored source (`emDashGuard.test.ts`).

### The gap: prompt hygiene (invariant 7)

The one missing guard was a check that the prompt builders carry no hardcoded example figure
that a model could echo as if it were a real measurement. `lib/cortex/src/prompts/promptHygiene.ts`
is a pure detector: `scanLineForLiteralFigures` matches digits welded to a unit (basis
points, percent, dollar) with three unit-anchored regexes, so a bare placeholder, a schema
field name, or a numeric scale bound never matches, and a line carrying the
`PROMPT_HYGIENE_ALLOW_MARKER` is an explicit, greppable exemption. `promptHygiene.test.ts`
walks the real prompt directory (excluding test files and the detector module, which
necessarily contain the example strings), asserts the authored builders scan to zero, then
proves the guard bites on synthetic bps, percent, and dollar strings while staying clean on
legitimate placeholders and interpolation tokens. No prompt source was altered to pass; the
scan was green on the real sources.

### CI blocks on failure

`.github/workflows/ci.yml` installs with a frozen lockfile then runs `pnpm run typecheck`,
`pnpm run build`, and `pnpm run test` as separate required steps of the `verify` job, so any
nonzero exit fails the job and blocks the merge. The hosted runner cannot execute inside
this environment, so the same four steps are run locally and pass, which is the evidence the
hosted job would produce (a recurring environmental fact logged since Phase B).

### Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 482 tests (api-server 198 across 26 files, portal 149, cortex 84 across
  10 files, connectors 29, edge-agent 10, db 8, scripts 4); the 4 new tests are the
  prompt-hygiene guard.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, `.replit`, and `.github`, and a database-wide cast over every text and jsonb
  column in every public table (`TOTAL DASH HITS 0`).
- Zero new npm dependencies (Vitest was already in the lockfile; the detector is pure
  TypeScript, the guard uses only `node:fs` and `node:path` in the test).

## Phase S: retention and deletion

Phase S gives derived signals a lifecycle: a scheduled time-to-live purge so a tenant's
derived state does not outlive its usefulness, and an operator-authorized erasure that removes
a tenant's derived signals on demand. Both leave evidence, and the erasure preserves the
append-only provenance ledger rather than trimming it. The phase added zero npm dependencies
and contains no em-dash or en-dash in source or in data.

### The retention_events audit table

`lib/db/src/schema/retentionEvents.ts` adds `retention_events`, the what/when/authority record
for every retention action. A `retention_action` enum carries the two kinds, `ttl_purge` and
`tenant_erasure`. The row records `tenantId` and `authorityUserId` as set-null foreign keys so
the audit survives the later deletion of the tenant or the operator it names, the
`authorityRole`, a `scope` jsonb, a `deletedDerivedSignalCount` integer defaulting to zero, an
optional `redactionLedgerEntryId` uuid that points at the provenance redaction (deliberately a
plain pointer, not a foreign key, so the ledger remains an independent append-only structure
the audit never constrains or cascades into), a `reason`, and `createdAt`. Two indexes serve
the by-tenant and by-time reads.

### The append-only ledger, composed in a transaction

The erasure must delete derived signals and append a redaction atomically, but the provenance
ledger must never gain a mutation path. `ledger.ts` is refactored to expose `appendEntryTx`,
which performs the same advisory-locked tail-read-then-insert append inside a caller's
transaction; `appendEntry` is now a thin wrapper that opens its own transaction and delegates
to it. The exported surface is `appendEntry`, `appendEntryTx`, and `verifyChain`: still no
update and no delete, so the ledger stays append-only while the erasure can compose its
redaction into the same transaction as its delete.

### The TTL purge

`runRetentionPurge` deletes every derived signal whose `computedAt` has fallen behind the TTL
cutoff. Because a refresh supersedes the prior set and resets `computedAt`, "not refreshed
within the TTL" is exactly this predicate. `getRetentionTtlDays` reads `RETENTION_TTL_DAYS` (a
positive integer number of days) and defaults to 90. The purge writes one `ttl_purge` audit
row per affected tenant; a tick that purges nothing writes no row and logs nothing, so the
audit never holds an empty-tick artifact. `startRetentionPurge` runs the loop on
`RETENTION_PURGE_INTERVAL_MS` (default 6 hours) and mirrors the connector-maintenance and
notifier loops exactly: started only from the server entrypoint, never overlapping, swallowing
a tick failure so a transient error never crashes the process, and unref'ing its timer.

### The tenant erasure

`eraseTenantDerivedSignals` runs in a single transaction: it deletes the tenant's derived
signals (returning their ids and provenance refs), computes a `sha256` digest over the sorted
ids, the sorted provenance refs, the count, and the scope, appends a provenance redaction
through `appendEntryTx` with `claimPath` `redaction:derived_signals:tenant` and `sourceRef`
`sha256:<digest>`, and inserts a `tenant_erasure` audit row carrying the redaction entry id.
The delete, the redaction, and the audit share one transaction, so the erasure is all or
nothing, and `verifyChain` still passes afterward because the ledger only grew. The redaction
is a statement that the referenced signals were erased, with the digest as evidence, never the
erased values.

### The HTTP surface

`artifacts/api-server/src/routes/retention.ts` is an owner-only router mounted in `app.ts`.
`DELETE /api/retention/tenants/:id/derived-signals` runs the erasure; a body carrying a
`tokenRef` is rejected with a 400 and the code
`token_erasure_not_supported_for_aggregate_signals` before any delete (derived signals are
aggregate math with no identity thread, so a token-scoped erasure has nothing to scope to),
and an unknown tenant returns a 404 `tenant_not_found`. `GET /api/retention/tenants/:id/events`
returns the audit trail. A client and a member each receive a 403.

### Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 495 tests (api-server 211 across 28 files, portal 149, cortex 84 across
  10 files, connectors 29, edge-agent 10, db 8, scripts 4); the 13 new tests are the retention
  service integration suite (5: TTL purge of a stale signal, retention of a fresh signal, the
  empty-tick no-audit no-op, the erasure delete plus redaction plus audit with the chain still
  intact, and the aggregate-scope guard) and the retention route integration suite (8: owner
  erasure, client and member 403, unknown-tenant 404, token-scope 400, the events read, and
  the audit shape), with the ledger surface test widened to admit `appendEntryTx`.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, `.replit`, and `.github`, and a database-wide cast over every text and jsonb
  column in every public table (`TOTAL DASH HITS 0`, now including `retention_events`).
- Zero new npm dependencies (the purge and erasure use the existing pg-backed db, the Node
  `node:crypto` digest, and workspace packages only).

### Logged drift

- Token-scoped erasure is deliberately unsupported for derived signals: aggregate math has no
  identity thread, so a `tokenRef` is rejected rather than silently widened to a full tenant
  erasure. A future per-identity store would add a real token-scoped path.
- The provenance ledger is never trimmed: an erasure appends a redaction rather than deleting
  the entries it references, so the hash chain stays intact and `verifyChain` keeps passing.
- `appendEntryTx` is an append-only transaction composition helper, not a mutation path, and
  must not be reverted; the erasure relies on appending the redaction in the same transaction
  as its delete.
- `retention_events.redactionLedgerEntryId` is a plain uuid pointer, not a foreign key, so the
  audit table and the provenance ledger remain independent structures.

The architect `evaluate_task` returned PASS with no blocking issues. The drift report is
`phase-S.md`; the drift index and the rollup are updated to "A through S". Per the
owner-authorized autonomous R-S-T run this does not pause; it proceeds to Phase T, the
milestone, after which execution stops for owner review.

## Phase T: client onboarding experience

Phase T is the third and final phase of the owner-authorized autonomous R-S-T run and is itself
the milestone hard stop. The Operations prompt frames this stage as "add organizations", but
organizations, the four roles, scoped registration PINs, and per-tenant fencing already landed
in Phase D, so Phase T delivers what was missing on that base: a client-admin onboards their own
read-only colleagues without the provider, the client side has an honest first run, the
client-viewer seat is fenced off from everything that crosses the client boundary, and the
rollout is documented.

### The logged decision

A client-viewer sees the diagnosis, the full reasoning chain, and the provenance for their own
bound tenant, and nothing that crosses the client boundary: not cost or spend, not connector
internals, not another tenant, not the break-glass raw-signal path, and not the action write
surface. The client-viewer is a strictly read-only seat; provider seats and the client-admin
(on their own tenant) remain the writers.

### The client onboarding router

`artifacts/api-server/src/routes/client.ts` is a new `/api/client` router, session-gated and
restricted to `client-admin` callers bound to an org. `POST /viewer-pins` mints a client-viewer
PIN whose scope is forced server-side to the caller's own org and the `client-viewer` role; a
widening attempt in the body is rejected loudly (`scope_org_forbidden`, `scope_role_forbidden`)
rather than silently overridden. `GET /viewer-pins` lists only own-org viewer invites, and
`POST /viewer-pins/:id/revoke` revokes only an own-org viewer invite (a cross-org or non-viewer
PIN is 404). A shared `mintInvitePin` helper now backs both this route and the owner admin route
so they mint identically.

### The read-only client-viewer

Both action mutation routes in `tenants.ts` now return 403 for a client-viewer after the
tenant-access check, so a viewer reads the war room and track record but cannot commit a move or
advance an action. The break-glass human-signal read in `security.ts` now refuses any
non-provider role before the grant check, closing the one client-reachable path to raw decrypted
signals. The portal mirrors both gates: the war room hides the commit and status controls for a
viewer, so no affordance silently fails.

### The client first run

`clientApi.ts` is a framework-free typed client (list, mint, revoke) that maps a 401 to
unauthorized, a non-ok body to its server error code, an empty list to a distinct empty state,
and a thrown fetch to an error. `Onboarding.tsx` is the client-admin first-run surface (mint a
one-time viewer code, list own-org invites with the active versus revoked distinction, revoke),
with honest loading, empty, ready, and error states. The rollout is documented in
`docs/client-onboarding-runbook.md`.

### Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 526 tests (api-server 227, portal 164, cortex 84, connectors 29,
  edge-agent 10, db 8, scripts 4); the 31 new tests are the 14 client onboarding route tests, 2
  read-only proofs in the tenants route suite, and 15 portal `clientApi` tests, with the
  positive action-write tests moved to a bound client-admin actor.
- Long-dash sweep zero on both sides (the source guard and a database-wide row cast over every
  public table, `TOTAL DASH HITS 0`).
- Zero new npm dependencies.

### Logged drift

- "Client onboarding experience", not "add organizations": the primitives are Phase D; T builds
  the self-serve onboarding, first run, and runbook on top.
- The client-viewer is read-only, extending the plan's read list with an explicit write refusal
  (the architect's recommendation, applied and logged).
- Break-glass is now provider-only: a client boundary that fences off source data must also fence
  off its closest proxy, so a client seat is refused before the grant check.

The architect `evaluate_task` returned PASS (no remaining HIGH or MEDIUM, after the first
review's HIGH on a writable client-viewer was fixed and re-verified). The drift report is
`phase-T.md`; the drift index and the rollup are updated to "A through T". Phase T is the
milestone hard stop and the end of the R-S-T run: execution PAUSES for owner review and does not
auto-advance.

## Phase U: backups and disaster recovery

Phase U is the second-to-last phase of Stage 3 (Operations and Hardening), run back to back with
V and W under owner authorization; the hard stop is after W, before milestone X. The platform
owns durable Postgres storage and point-in-time recovery, so Phase U mirrors the honesty
boundary Phase Q drew around durable secret storage: it documents the targets and the operator
responsibility (RPO, RTO, the retention window, the logical-restore versus PITR distinction, the
restore procedure) in `docs/backup-and-dr-runbook.md`, and builds the application-real parts on
that base: a crown-jewel logical export with a proven scratch restore, a provenance-ledger
archive to durable object storage with a verifiable chain copy, a scheduled archive loop, an
audit table, and owner-only routes.

### The crown-jewel logical backup and the proven scratch restore

The crown jewels are the five tables whose loss could not be recomputed: `derived_signals`,
`provenance_ledger`, `users`, `invite_pins`, and `tenant_keys` (the `kmsKeyRef` REFERENCE only,
never key material). `crownJewels.ts` exports each table with `row_to_json`,
`restoreCrownJewelsIntoScratch` rebuilds each into an isolated `scratch_restore_*` schema in the
same database (`CREATE TABLE ... LIKE ... INCLUDING DEFAULTS INCLUDING CONSTRAINTS`, no FKs or
indexes, so it can never collide with live data), and `runRestoreDrill` exports, restores,
verifies the per-table row counts, re-walks every restored tenant chain, then always drops the
scratch schema even on failure. The chain check reads back the RESTORED `provenance_ledger` rows
out of the scratch schema and re-walks them with `verifyLedgerEntries`, so a green
`chainVerified` is earned by the round-tripped data, not restated from the in-memory export
bundle. The bundle never holds a secret value, only ciphertext, one-way hashes, and references.

### The provenance-ledger archive

`ledgerArchive.ts` exports a canonical, stable-order serialisation of the whole ledger plus a
per-tenant chain manifest to durable object storage, with a `sha256` over the content-only
canonical bytes (no wall-clock field, so an unchanged ledger is skipped rather than
re-archived). It re-verifies every tenant chain at export, writes write-once where the store
supports it, and records exactly one `backup_events` row per archive run.
`verifyLedgerArchiveObject` reads an object back and re-confirms the digest over the actual bytes
and re-walks each chain. An empty or unchanged ledger writes no object and no row, returning
`skipped`, so the archive doubles as a tamper-evidence record that survives database loss.

### The "available, not connected" archive store

The archive store mirrors `gcpSecretStore`. `ARCHIVE_STORE_PROVIDER` unset or `local` uses a
local-filesystem store (`archiveStore.ts`), so the archive and restore cycle are provable on a
laptop; `gcs` selects the zero-SDK GCS JSON-API adapter (`gcsArchiveStore.ts`) over the Node
global fetch, which validates nothing at construction and throws a precise "set
GCS_ARCHIVE_BUCKET to connect it" error on first use. Every object key is validated against a
traversal-safe grammar before any call, the token is the cached GCP metadata token or an env
token, and every request is bounded by `GCS_ARCHIVE_TIMEOUT_MS` (default 10000).

### The scheduled loop, the audit, and the owner routes

`backupLoop.ts` runs the archive loop from the server entrypoint only (`index.ts`), mirroring
the retention and notifier loops: no overlap, swallow a tick failure, unref'd timer, cadence via
`BACKUP_ARCHIVE_INTERVAL_MS` (default 12 hours). The new `backup_events` table mirrors
`retention_events` (a `backup_action` enum, set-null `tenantId` and `authorityUserId`, the
object key, digest, entry and tenant counts, chain-verify result, scope, and `createdAt`), one
row per archive run and none on a skipped run. The owner-only routes (`backups.ts`, behind
`requireAuth` and `requireOwner`) are `POST /api/backups/ledger-archive` (trigger),
`GET /api/backups/events` (audit history), and `GET /api/backups/status` (store provider and
connection state, cadence, last archive; never a credential, bucket, or path).

### Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 557 tests (api-server 258 across 32 files, portal 164, cortex 84,
  connectors 29, edge-agent 10, db 8, scripts 4); the 31 new api-server tests are the
  `archiveStore` local-store unit suite, the crown-jewel restore-drill integration suite (4
  tests), and the combined ledger-archive plus owner-route integration suite (combined so the
  `backup_events` writes stay sequential and clean up by collected digest).
- Long-dash sweep zero on both sides (the source guard and a database-wide row cast over every
  text and jsonb column in every public table, now including `backup_events`).
- Zero new npm dependencies.

### Logged drift

- Backups and PITR are a documented platform responsibility, not application code; Phase U
  documents the targets and the operator restore procedure and builds the application-real parts
  on that base (mirrors the Phase Q framing).
- The restore drill restores into a scratch SCHEMA in the same database, the strongest restore
  proof the application can make on its own; a full PITR-to-new-instance drill is the operator's
  platform-level procedure, documented in the runbook.
- The skip-unchanged archive guard is not globally serialised across processes (LOW, accepted).
  The loop runs from one entrypoint and never overlaps itself; only a manual trigger racing the
  scheduled tick could write a redundant, content-identical object under a distinct timestamped
  write-once key and a second honest, content-identical audit row, so integrity is never
  weakened. A database advisory lock or unique-digest constraint is an operational refinement,
  logged rather than built.

The architect `evaluate_task` returned PASS after the first review's one MEDIUM was fixed and
re-verified (the restore drill now verifies the chain from the restored scratch rows, not the
in-memory bundle). The drift report is `phase-U.md`; the drift index and the rollup are updated
to "A through U". Per the owner-authorized U-V-W run this does not pause; it proceeds to Phase V.

## Phase V: Verification and the build-report append (closes Stage 3)

Phase V is the closing verification of Stage 3 (Operations and Hardening, Phases N through U),
mirroring how Phase M closed Stage 2. It built no product feature and changed no product code; its
artifacts are the `phase-V.md` evidence matrix, this consolidated append, and the drift updates. Zero
new npm dependencies; no em-dash or en-dash in source or data.

### The section 9 verification (12 points)

All twelve points of section 9 of the Operations prompt are met or honestly accounted for; the full
matrix with the proof type per point is in `docs/drift/phase-V.md`. In brief: typecheck, build, and
the full 557-test suite pass (hosted CI is a standing environmental drift, run locally); the cost rows
and the Spend reconciliation, the capped-tenant block, the OAuth-expiry and throttle recovery with the
dead-connector alert, the failed-seed-fires-exactly-one-notification drain, the no-secret-value sweep
over every table and `.replit`, every Phase R invariant's red-on-break test, the TTL purge and the
chain-preserving erasure, the client-viewer fencing, and the scratch-schema restore drill are each
proven by the integration suite against live Postgres; the em-dash sweep is zero on both sides. The
honest integration-versus-live boundaries (live paid model seeds were Phases C and F; OAuth refresh is
proven against an injected seam; the external sinks and the durable cloud backends are
available-not-connected; a full PITR-to-new-instance restore is operator-level) are marked as such in
the matrix.

### Consolidated Stage 3 reference

New tables (Stage 3): `model_usage` (N, one row per real billed model call), `alert_events` (O, the
alert seam the Phase P notifier drains), `retention_events` (S, the purge and erasure audit), and
`backup_events` (U, one row per archive run). The `pipeline_jobs` claim queue predates Stage 3 (F).

New routes (Stage 3), all behind `requireAuth`: owner-only `GET /api/spend` (N cost console),
`/api/operations` (O and P operations screen), and `/api/backups` (U trigger, events, status); the
owner-only `GET /api/security/tenants/:id/connector-health` (O); the owner-only retention routes under
`/api/retention` (S erasure and events); and the client-admin self-serve `/api/client` (T). The health
router is mounted at `/` with an env-gated deep probe (P).

Secret store choice: every runtime secret is resolved by name through the `SecretStore` seam (Q), never
read from `process.env` at the call site. `SECRET_STORE_PROVIDER` unset or `env` uses the local
env-backed read store (the platform owns durable secret storage); `gcp` selects the zero-SDK GCP Secret
Manager REST adapter, available-not-connected until `GCP_PROJECT_ID` is set. `tenant_keys.kmsKeyRef`
deliberately stays on the separate KMS boundary, not in the secret store.

Test and CI setup: Vitest across seven workspace packages (api-server 258, portal 164, cortex 84,
connectors 29, edge-agent 10, db 8, scripts 4 = 557), with `.github/workflows/ci.yml` running
typecheck, build, and test as separate required steps that block the merge on any nonzero exit.

Retention and operational defaults (all env-overridable): retention TTL `RETENTION_TTL_DAYS` 90 days
and purge cadence `RETENTION_PURGE_INTERVAL_MS` 6 hours; budget caps `SPEND_GLOBAL_MONTHLY_CAP_USD`
1000, `SPEND_TENANT_MONTHLY_CAP_USD` 50, `SPEND_ALERT_THRESHOLD` 0.8; backup archive cadence
`BACKUP_ARCHIVE_INTERVAL_MS` 12 hours.

Org and role model (D, extended in T): one provider org plus per-client orgs, four roles, namely
`provider-owner`, `provider-member`, `client-admin`, and `client-viewer`. The provider-owner is the
sole owner-gated authority (spend, operations, backups, retention erasure, break-glass
administration); the client-admin self-serves client-viewer onboarding for its own org only; the
client-viewer is a strictly read-only seat fenced to its own tenant.

Backup and DR targets: the RPO, RTO, retention window, and the logical-restore-versus-PITR distinction
are documented in `docs/backup-and-dr-runbook.md`; the application proves a crown-jewel logical export
and a scratch-schema restore with a re-walked ledger chain, plus a scheduled ledger archive to durable
object storage (local-fs default, zero-SDK GCS adapter) carrying a verifiable chain copy.

### Verification

Typecheck and build green (exit 0); full suite green at 557 tests; long-dash sweep zero on both sides
(the source guard and a database-wide cast over all 107 public text and jsonb columns); zero new npm
dependencies. The architect `evaluate_task` returned PASS. The drift report is `phase-V.md`; the drift
index and the rollup are updated to "A through V". Per the owner-authorized U-V-W run this does not
pause; it proceeds to Phase W, the opening of Stage 4. The hard stop is after Phase W, before
milestone X.

## Phase W: the outcome loop and value realized (opens Stage 4)

Phase W opens Stage 4 (Differentiation and Moat). It turns the track record from a list of intentions
into a graded history: a numeric prediction is snapshotted at commit time, real measured outcomes are
recorded against it, value identified is summed against value realized, and the system grades its own
accuracy with a simple, honest calibration score. Zero new npm dependencies; no em-dash or en-dash in
source or data. Per the adaptation guide the calibration is kept deliberately loose because milestone
AJ later supersedes it with a Brier-scored ledger.

### New schema

`committed_actions` gains three commit-time snapshot columns: `predicted_value_usd` (`numeric(14,2)`),
`baseline_metric` (`numeric`), and `baseline_at` (`timestamptz`), all nullable so an action with no
parseable dollar figure has no numeric prediction and an outside-in action has no measured baseline.
A new `outcome_measurements` table records one row per real measurement against an action (`actionId`
FK cascade, `measuredAt`, `actualMetric`, `realizedValueUsd` `numeric(14,2)`, `varianceVsPrediction`
`numeric(14,2)`, `basis`, `status`, `note`, `recordedBy` FK set-null, `createdAt`), with two new enums
`outcome_measurement_basis` (`measured`, `modelled`) and `outcome_measurement_status` (`pending`,
`on_track`, `realized`, `missed`).

### New routes

All under the existing tenant router behind `requireAuth` and the tenant access fence:
`POST /api/tenants/:id/actions/:actionId/measurements` (provider-only; records a measurement, basis
derived from whether a real scalar derived signal backs it, status and variance derived server-side),
`GET /api/tenants/:id/actions/:actionId/measurements` (the measurements for an action), and
`GET /api/tenants/:id/outcomes` (the computed value-identified-versus-realized summary and the
calibration). The action-commit route is extended to snapshot the prediction and, in connected mode,
the named-signal baseline.

### The honesty boundaries

`predictedValueUsd` is parsed from a currency-anchored impact only (a `$` or `USD` token); a
percentage, a margin-point figure, or prose yields null rather than an invented dollar value. The
baseline is snapshotted only from a single real scalar derived signal in connected mode, null
otherwise. `basis=measured` is reserved for an outcome grounded in a real derived signal reading; a
missing or non-scalar signal is a loud `400 signal_not_found`, never a silent downgrade to `modelled`.
`status=missed` is set only on a final measurement, so an in-flight action below its prediction reads
`on_track`. The value counter and the calibration badge are computed entirely in the pure
`outcomeMath` module from already-persisted numbers, so the summary reconciles against a direct
database sum, the latest measurement per action is used so a re-measured action is never
double-counted, and an empty record returns a null calibration score rather than a fabricated 100
percent. The Track Record (actions) surface is elevated with the counter, the badge, and per-action
realized/variance/basis rather than a new hero, because V2 has no business-performance hero surface.

### Verification

Typecheck and build green (exit 0; portal 1743 modules, api-server bundled); full suite green at 593
tests (api-server 286 across 34 files including the new `predictedValue` and `outcomeMath` unit tests
and the outcome-loop integration tests, portal 172 across 14 files including the new `outcomeApi`
tests, cortex 84, connectors 29, edge-agent 10, db 8, scripts 4); long-dash sweep zero on both sides
(the source guard and a database-wide cast over all 108 public text and jsonb columns, including the
new `outcome_measurements.note`); zero new npm dependencies. The architect `evaluate_task` returned
PASS. The drift report is `phase-W.md`; the drift index and the rollup are updated to "A through W".
Phase W is the last phase before milestone X (benchmarking), so this is a HARD STOP for owner review;
execution does not auto-advance into Phase X.
