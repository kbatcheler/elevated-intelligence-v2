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

## Phase X: benchmarking and the data network effect (security milestone)

Phase X turns one tenant's private math into a cross-tenant benchmark without ever exposing another
tenant's raw data or identity. A tenant that opts in sees where its own figure sits inside a
de-identified distribution of its cohort (sector by revenue band); below the k-anonymity floor it sees
an honest lock rather than a fabricated comparison. This is a security milestone, so a HARD STOP for
owner review follows it.

### The privacy posture (stated plainly)

The published benchmark tables hold NO raw client values and NO tenant references of any kind. A
`benchmark_cohorts` row is a population (a unique segment key, the normalized sector and revenue band,
a member count, a computed-at). A `benchmark_stats` row is a distribution over that population (p25,
p50, p75, a sample count, a `noised` flag), with no tenant column and no raw value. The recompute audit
`benchmark_events` is identity-free by construction (action, cohort count, stat count, skipped-tenant
count, the configured min cohort, the authorizing user and role). The ONLY tenant-scoped audit path in
the whole feature is `benchmark_consent_events`, which records that a named tenant opted in or out and
on whose authority. The live layer-detail read positions the REQUESTING tenant's own figure against the
already-de-identified cohort stats, never against another tenant's value, and never returns a
contributor list.

### What was built

Schema (pushed to dev Postgres, exported from `lib/db/src/schema/index.ts` via a new `benchmarks`
module): `tenants.benchmark_opt_in` (boolean, default false), `benchmark_consent_events`,
`benchmark_cohorts`, `benchmark_stats`, and `benchmark_events`.

The recompute reads each opted-in tenant's decrypted scalar derived signals through the MACHINE
grounding read extracted from the orchestrator path, not the break-glass human read. The single-tenant
helper fails loud on a revoked or missing key; the batch caller catches that per tenant, SKIPS the
tenant, and counts it in `skipped_tenant_count`, so one crypto-shredded tenant can never fail the whole
run or silently corrupt a cohort. The pure benchmark math computes the percentiles over the pooled
readings, suppresses any cohort below `BENCHMARK_MIN_COHORT` (default 5) so a distribution can never be
reconstructed from a cohort too small to hide an individual, and publishes a cohort in
`[minCohort, noiseBand)` (`BENCHMARK_NOISE_BAND`, default 20) with bounded random noise tied to a
fraction of the IQR (0.1) and clamped so `p25 <= p50 <= p75` always holds, flagged `noised = true` and
surfaced as "privacy protected". `runBenchmarkRecompute` is pure and supersedes the prior cohort and
stat set; `startBenchmarkRecompute` runs from the server entrypoint only (no overlap, a swallowed tick
failure, an unref'd timer, cadence `BENCHMARK_RECOMPUTE_INTERVAL_MS`, default 12 hours), mirroring the
retention, notifier, and backup loops.

Routes: tenant-access `GET`/`POST /api/tenants/:id/benchmark-consent` (the default-off toggle and its
event history; a read-only client-viewer is refused 403; a consent change writes one audit row in the
same transaction only when the state actually changes); the layer-detail read returns
`cohortBenchmark | cohortLock` alongside the existing modelled `peerBenchmark` (both null unless the
requester is opted in and eligible); and owner-only `POST /api/benchmarks/recompute`, `GET
/api/benchmarks/events`, and `GET /api/benchmarks/status`. The portal renders the verified-cohort
distribution band (p25/p50/p75 with the requester's own self marker, the sample count, a "Verified
cohort" pill, the noised "privacy protected" note), the honest below-k lock, and the default-off
consent toggle, keeping the modelled `peerBenchmark` and the tiles fallback separate so the two bases
are never conflated.

### The honesty boundaries

A benchmark figure is computed from persisted, de-identified cohort math or it is not shown. The
k-anonymity floor and the disclosed bounded noise are privacy controls over a real distribution, never
invented numbers. The modelled `peerBenchmark` is kept alongside the verified `cohortBenchmark`, never
replaced, and the two are visually and structurally distinct, so a modelled estimate is never presented
as a verified cohort fact. The consent toggle reflects the persisted state and flips only after the
server confirms; the UI hides the control from a client-viewer but does not rely on that for
authorization (the server refuses with 403).

### Verification

Typecheck and build green (exit 0); full suite green at 627 tests (api-server 315 across 37 files
including the new `benchmarkMath` unit tests and the benchmark integration tests, portal 177 across 14
files including the extended `tenantApi` tests, cortex 84, connectors 29, edge-agent 10, db 8, scripts
4); long-dash sweep zero on both sides (the source guard returns an empty violation list and a fresh
`rg` over the authored tree returns zero, and a database-wide cast over all 118 public text and jsonb
columns, now including the benchmark tables and `benchmark_consent_events.reason`, reports zero hits);
zero new npm dependencies. The architect `evaluate_task` returned PASS, with one non-blocking hardening
note (the live cohort read could re-gate stale stat rows against the current min-cohort and noise
configuration; logged as drift, not built, because the recompute always re-applies the current config
and a stricter floor only ever makes the next recompute more conservative). The drift report is
`phase-X.md`; the drift index and the rollup are updated to "A through X". Phase X is a security
milestone, so this is a HARD STOP for owner review; execution does not auto-advance into Phase Y.

## Phase Y: portfolio intelligence view

Phase Y opens the owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC, which pauses at the
Stage 4/5 boundary before Phase AD). The "portfolio" org type already exists from Phase D, so
Phase Y builds ONLY the experience over it: a ranked multi-company board, cross-portfolio gap
patterns, and a drill-down into any bound tenant's full diagnosis. It is not a milestone.

### What was built

One read assembles the board (`GET /api/portfolio/summary`, mounted under the shared
`requireAuth` gate). Scope is resolved server-side from the session alone, never from the
client: a provider seat sees every tenant as a portfolio; a seat whose `orgType` is `portfolio`
with an `orgId` sees only the tenants its org is bound to through `org_tenants`; every other seat
(a client org, or a user with no org) is refused with `403 portfolio_only`, and a missing
session is `401`. A portfolio caller can never reach a tenant outside its bindings because it
never names a tenant; the binding set is the query. An empty binding set is an honest empty
board, not an error. The read fans out over only the in-scope tenant ids for the tenant rows,
the layer catalogue, the persisted `tenant_layers` content, the `committed_actions`, and the
`outcome_measurements` joined back to their actions, with every jsonb projection defensive (a
malformed value becomes null, never a fabricated stand-in).

The pure `portfolioMath` module ranks each bound tenant by realized-and-at-risk value and
open-gap severity so the worst and best surface to the top, counts open gaps by severity, rolls
the per-tenant outcome summary (via the shared `computeOutcomeSummary`) into portfolio totals
with NULLABLE dollar figures, and derives cross-portfolio gap patterns only from persisted
tenant-layer gaps and only for a gap shared by at least two tenants ("N of M companies have
..."). The auth payload now carries `orgType` (the middleware left-joins `orgs`; the auth routes
return it via an `orgTypeFor()` helper) purely so the portal can offer the nav; the server still
fences the data by the session binding, never by this field. The portal adds a framework-free
`portfolioApi.ts` (a discriminated union mapping 401 and 403 to their own states), a
`PortfolioPage` state machine (ranked board, patterns, drill-down via `setCurrentId` then
navigate, distinct loading/empty/ready/forbidden/error states), the mirrored portfolio types,
the `/portfolio` route with no client-side role gate (the server fences), and a TopNav link
shown only to a provider or portfolio seat.

### The honesty boundaries

Every portfolio figure is computed from persisted state or it is not shown. A company with no
currency-anchored prediction or no measurement carries null dollar figures, which `formatUsd`
renders as a dash, never a fabricated `$0` or an invented "value at risk". The totals expose how
many companies actually have layer content and outcomes behind the numbers. A gap unique to one
company is never promoted to a cross-portfolio pattern. The `/portfolio` route has no client-side
role gate on purpose: access is the server's (`403 portfolio_only` rendered as an honest
forbidden state), not the nav's.

### Verification

Typecheck and build green (exit 0; portal 1746 modules, api-server bundled); full suite green at
646 tests (api-server 334 across 39 files including the new `portfolioMath` unit tests and the
portfolio integration tests, portal 177 across 14 files, cortex 84, connectors 29, edge-agent
10, db 8, scripts 4); long-dash sweep zero on both sides (a fresh `rg` over the authored tree and
a database-wide cast over all 118 public text and jsonb columns, unchanged because Phase Y added
no schema); zero new npm dependencies. The architect `evaluate_task` returned PASS, with one
non-blocking item (no dedicated portal unit test for `PortfolioPage` / `portfolioApi`; the server
integration tests carry the functional and authorization coverage). The drift report is
`phase-Y.md`; the drift index and the rollup are updated to "A through Y". Phase Y is not a
milestone; per the owner-authorized Stage 4 run, execution continues to Phase Z and does not
pause here (the pause is at the Stage 4/5 boundary before Phase AD).

## Phase Z: proactive push intelligence

Phase Z is the second phase of the owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC,
which pauses at the Stage 4/5 boundary before Phase AD). It turns the persisted outcome loop
into recorded, ranked, deliverable notifications: a per-user in-app notification center,
per-(user, tenant, kind) rules a seat can tune and mute, and a scheduled Morning Brief digest
delivered to a chosen channel. It is a deliberately SEPARATE seam from the Phase O/P
operational alert seam (`alert_events`): those are connector and ops-health events for the
provider-owner; these are business-intelligence notifications for any seat, with their own new
enums so the two lifecycles never entangle. It is not a milestone.

### What was built

Two new tables (`lib/db/src/schema/pushIntelligence.ts`). `push_rules` is per-user, per-tenant,
per-kind (`ownerUserId` NOT NULL, unique on `(ownerUserId, tenantId, type)`), carrying
`enabled`, a `mutedUntil`, optional `minImpactUsd` / `minConfidence` floors (null means no
floor), and a `channel`; a default rule (enabled, no floor, in_app) is materialized lazily for
each tenant a user can reach. `push_events` is one recorded notification, idempotent by
`(ruleId, dedupeKey)` so the same breach in the same state never notifies twice and a state
change mints a new event, with owner and tenant denormalized for a single-table inbox and a
belt-and-suspenders access check. Three new enums (`push_rule_type` of `outcome_shortfall` and
`high_value_action`; `push_channel` of `in_app`, `slack`, `email`; `push_delivery_status` of
`pending`, `suppressed`, `sent`, `failed`).

The evaluator (`pushEvaluator.ts`) each pass materializes the default rules, builds candidate
breaches from real rows only (a `high_value_action` is an open committed action carrying a
parsed dollar prediction; an `outcome_shortfall` is the latest measurement of an action graded
`missed` with a positive dollar shortfall), scores each candidate under each enabled rule
(`rankScore` is `impactUsd * confidence / 100`), and records a `pending` or `suppressed` event
with ON CONFLICT DO NOTHING. A disabled rule produces nothing; a muted rule still evaluates but
records suppressed, so a mute hides noise without losing the record. The drainer
(`pushNotifier.ts`) mirrors the Phase P alert notifier: it claims pending rows with FOR UPDATE
SKIP LOCKED, groups them per (recipient, channel), delivers exactly one ranked digest per group
(capped at `PUSH_DIGEST_LIMIT`, default 10; the overflow stays in the center), and flips every
claimed row to `sent` or `failed` exactly once. `in_app` is a no-op that always succeeds;
`slack` reuses `SLACK_WEBHOOK_URL`; `email` is an available-not-connected adapter that fails
loudly with "set EMAIL_PUSH_ENDPOINT to connect the email push channel" rather than silently
dropping a notification. The scheduled Morning Brief (`pushBrief.ts`, `startPushMorningBrief`,
cadence `PUSH_MORNING_BRIEF_INTERVAL_MS`, default 12 hours) runs the evaluation then the drain,
started ONLY from the server entrypoint, mirroring the retention, notifier, and backup loops
(no overlap, swallow a tick failure, unref'd timer). The HTTP surface
(`routes/push.ts`, mounted at `/api/push` under `requireAuth`) is `GET /notifications`,
`POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /rules`, `PATCH /rules/:id`,
and `POST /rules/:id/mute`, every read and write fenced per-user and per-tenant. The portal adds
a framework-free `pushApi.ts` (honest discriminated states plus a pub/sub that refreshes the nav
badge on a successful mark), a `NotificationsPage` (distinct loading, empty, ready, error states;
per-event impact and rank; read, read-all, tune, mute), the `/notifications` route with no
client-side role gate (the server fences), and the `TopNav` NavBell unread badge.

### The honesty boundaries

Every event figure is computed from persisted state or it is null; `rankScore` is zero when
unquantified, so an event with no dollar figure ranks last and is suppressed, never promoted,
and a null impact renders as an empty bracket in the digest, never a fabricated `$0`. A breach is
recorded once per state (idempotent by `(ruleId, dedupeKey)`); a mute records suppressed events
rather than dropping them, so nothing high-signal is lost. The access fence holds on BOTH the
mint and the deliver path: a push rule whose tenant binding was revoked after it was created is
dropped by the evaluator before any event is minted, and a pending event whose (owner, tenant)
pair is no longer reachable at delivery time is failed in place WITHOUT being handed to an
external transport, so a tenant's business intelligence is never leaked to a recipient who can no
longer read it in the center. `slack` and `email` are available-not-connected sinks that fail
loudly when unconfigured rather than pretending to send.

### Verification

Typecheck and build green (exit 0; portal 1748 modules, api-server bundled); full suite green at
685 tests (api-server 357 across 41 files including the new `pushMath` unit tests and the push
integration tests with the revocation regression, portal 193 across 15 files including the new
`pushApi` tests, cortex 84, connectors 29, edge-agent 10, db 8, scripts 4); long-dash sweep zero
on both sides (the source guard plus a database-wide cast over all 123 public text and jsonb
columns, now including the `push_rules` and `push_events` text columns); zero new npm
dependencies. The architect `evaluate_task` first returned FAIL on a broken-access-control
finding (a revoked binding could still mint and deliver push events); the fix closed both the
mint path (the evaluator fences its loaded rules to the pairs reachable right now) and the
deliver path (the drainer re-verifies access and fails revoked rows without delivery), with a
self-contained revocation integration test as the regression guard, after which the architect
`evaluate_task` returned PASS. The drift report is `phase-Z.md`; the drift index and the rollup
are updated to "A through Z". Phase Z is not a milestone; per the owner-authorized Stage 4 run,
execution continues to Phase AA and does not pause here (the pause is at the Stage 4/5 boundary
before Phase AD; the next protocol milestone hard stop is AI at the end of Stage 5).

## Phase AA: interactive challenge

Phase AA is the third phase of the owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC,
which pauses at the Stage 4/5 boundary before Phase AD). It lets a seat CHALLENGE one finding in
a layer's diagnosis: the objection is re-reasoned through the Confounder and Synthesist seats,
which either uphold the finding with reasoning or revise it with a new confidence and a note, and
every exchange is recorded as an append-only, auditable verdict. The user's input is context,
never an override: a challenge can never delete a finding, and a revise re-bases the challenge row
only, never the stored layer content. It EXTENDS Ask Different Day, it does not replace it. It is
not a milestone.

### What was built

One new table (`lib/db/src/schema/findingChallenges.ts`). `finding_challenges` is one recorded
challenge against one finding: the tenant, the layer key, the `findingRef`, a `findingHashRef`
(the sha256 of the canonical finding text at challenge time, so a later refresh that changes the
finding is detectable), the challenger, the sanitized challenge text, the original confidence and
basis snapshot, the outcome's revised confidence and `revisedBasis`, the confounder note, the
synthesist reasoning, an `error` for an honest failure, the billed `telemetry`, and the
`provenanceContentHash` of the entry a success appended. Two new enums (`finding_challenge_status`
of `completed` and `failed`; `finding_challenge_outcome` of `upheld` and `revised`, null on a
failed row). New cortex stages re-test the objection (challenge-confound) and decide
uphold-or-revise (challenge-synthesis), both grounded, with no model literal in source.

The service (`artifacts/api-server/src/lib/challenge/findingChallenge.ts`). `runFindingChallenge`
loads the live finding, hashes its canonical text, runs the Confounder then the Synthesist seat,
records each seat's billed model usage, and writes the outcome in ONE transaction: on success it
appends exactly one hash-chained provenance entry (claim path `<layerKey>.challenge.<findingRef>`,
source ref a `challenge:sha256:` digest over the outcome with the user text HASHED in, never
embedded) and inserts a `completed` row; on a model failure, or a `revised` verdict with no new
confidence, it inserts an honest `failed` row with the real billed telemetry and NO provenance,
never a fabricated uphold or an invented number. A revise sets `revisedBasis` to
`modelled_user_informed` on the challenge ROW only; the cortex basis enum and the stored layer
content are never touched. The pure helpers (`parseFindingRef`, `extractFinding`,
`canonicalFindingText`, `findingHash`, `currentFindingHash`) are unit-tested in isolation, and
`serializeChallenge` is the single shaper the list and the submit path share. `listFindingChallenges`
returns a tenant's challenges newest first, each annotated with the challenger's email (null when
removed) and an honest `isCurrentVersion` flag, loading each layer's content once.

The HTTP surface (`artifacts/api-server/src/routes/tenants.ts`, under `requireAuth` and
`requireTenantAccess`): `POST /tenants/:id/layers/:key/challenges` and `GET /tenants/:id/challenges`.
The POST order is the tenant fence, then a zod parse (the `findingRef` must match the challengeable
kinds; the `challengeText` is bounded, trimmed, and refused when empty after trim), then the
client-viewer model-spend gate, then the live re-reasoning, so a malformed body, a blank body, or a
read-only seat is rejected BEFORE any model call. The portal adds a framework-free `challengeApi.ts`
(honest discriminated fetch and submit states plus `groupChallengesByRef`), a `ChallengeControl`
(an inline challenge box and per-finding history; a seat that cannot challenge sees the history but
no submit box), `FindingChallengeSlot` wired into the Causes, Actions, and Challengers cards, the
layer page (which fetches challenges alongside the layer and computes `canChallenge` as a
non-client-viewer seat), and the Ask Different Day page (which groups challenges by layer), all of
which extend the existing finding cards rather than replacing the perspective lens.

### The honesty boundaries

Every challenge verdict is computed by the two seats or it is an honest failure: a model call that
returns nothing usable, or a `revised` verdict with no new confidence, is a `failed` row with the
real billed telemetry and NO outcome and NO provenance, never a fabricated uphold or an invented
confidence. The user's objection is context, never an override: a challenge can never delete a
finding, and a revise re-bases the challenge row only (`modelled_user_informed`), never the stored
layer content, so a user can object but can never silently overwrite or remove a finding. A
completed challenge appends exactly one hash-chained provenance entry over source references with
the user text hashed in, so `verifyChain` still passes. The history's `isCurrentVersion` is
computed from the stored finding hash against the live finding, so a challenge against a
since-changed finding is shown as addressing a prior version, never misrepresented as current. The
user challenge text is sanitized once before it is used for the prompt or stored, so the long-dash
constraint holds for user input too.

### Verification

Typecheck and build green (exit 0; portal 1750 modules, api-server bundled); full suite green at
716 tests (api-server 377 across 42 files including the new `findingChallenge` pure-helper unit
tests and the challenge route-boundary tests, portal 204 across 16 files including the new
`challengeApi` tests, cortex 84, connectors 29, edge-agent 10, db 8, scripts 4); long-dash sweep
zero on both sides (the source guard plus a database-wide cast over all 135 public text and jsonb
columns, now including the `finding_challenges` text columns); zero new npm dependencies. The
architect `evaluate_task` returned PASS with no high or severe finding; two LOW items were fixed
rather than logged as accepted drift: the submit response now returns the same serialized contract
the history does (with this seat's email and the current-version flag, so a just-recorded challenge
is never mislabelled as "a removed user"), and the challenge text is trimmed and refused when empty
after trim (so a blank submission never spends a model call or stores a meaningless row). The
remaining accepted LOW is that the challenge-history fetch is treated as non-critical supplementary
data: a fetch failure renders the diagnosis without the overlay rather than blanking the page. The
drift report is `phase-AA.md`; the drift index and the rollup are updated to "A through AA". Phase
AA is not a milestone; per the owner-authorized Stage 4 run, execution continues to Phase AB and
does not pause here (the pause is at the Stage 4/5 boundary before Phase AD; the next protocol
milestone hard stop is AI at the end of Stage 5).

## Phase AB: the sellability pack (a finished diagnosis becomes a sales surface)

Phase AB is the fourth phase of the owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC). It
turns a finished diagnosis into a selling surface without rewriting a single finding: a provider
mints a read-only, summary-only shareable link that a cold prospect opens with no account; the
public diagnosis carries anonymized, segment-level social proof drawn from the real Phase W outcome
loop, plus a viral "powered by" mark and a path back to the product; and the narrate stage now
carries a deterministic editorial voice-quality measurement recorded honestly alongside the
content. It added zero npm dependencies and holds no em-dash or en-dash in source or in data.

### What it does

One new table (`diagnosis_share_tokens`, one privacy enum `diagnosis_share_privacy` of
`summary_only`) holds one read-only share of one tenant's diagnosis. The opaque token is 32 bytes
of CSPRNG entropy rendered base64url and is returned to the minter EXACTLY ONCE; only its sha256
hash ever touches a column, so a database read can never reconstruct a working link. The data layer
mints (clamping the lifetime to a 1-to-365-day band, default 30), lists a tenant's shares as
metadata only (never the token, never the hash, each with a status derived from its real columns:
revoked, expired, or active), revokes early and idempotently, and resolves a presented token by
hashing it, loading the one unexpired unrevoked row, recording real access telemetry, and returning
only the tenant id and privacy posture. A non-match (unknown, expired, or revoked) is
indistinguishable to the caller, which keeps the public 404 uniform.

The case-study builder produces anonymized, segment-level social proof from the real Phase W
outcome loop. A case study is a DISTRIBUTION over a cohort of opted-in tenants in one segment,
never a named company and never a single company's figure. It reuses the exact Phase X privacy
machinery: the same k-anonymity floor hard-gates whether a segment is published at all, and the
same bounded noise blurs a small cohort's quartiles with an honest `noised` flag. The per-tenant
math is the same `computeOutcomeSummary` the `/outcomes` endpoint uses, so a case study can never
disagree with the counter, and only a tenant with at least one resolved outcome (a real track
record) contributes; no tenant id, name, url, or date ever appears in the output.

The narrate stage gains a deterministic editorial voice-quality measurement (`evaluateNarrativeVoice`
in `lib/cortex`): seven genuine checks (sentence length in a human band, no marketing hype, no
first-person consultant voice, numeric specificity, has a proof receipt, names a blind spot, no
long dash) yield a 0-to-100 score, a band, and per-check detail. It is a MEASUREMENT, never an
edit: rewriting the prose to "pass" would be fabricating output, so the report is recorded on the
layer and a below-bar layer is shown at its real lower band.

The HTTP surface is two-sided. Authed provider/owner routes mint, list, and revoke share tokens and
read the published case studies (provider seat required; the tenant routes also require per-tenant
access, since selling is a provider-side action). The ONLY unauthenticated data surface is
`GET /api/public/diagnosis/:token`: it resolves the token through the share-token middleware, loads
the tenant overview, narrows each layer through `toPublicDiagnosisLayer` (which strips the internal
owner persona, the diagnostic question, and the layer feed graph), and returns the public layers,
the tenant's case study, and the constant powered-by mark, behind a tight per-IP rate limit. In the
portal, the public page is mounted OUTSIDE the auth provider (a cold prospect never triggers an auth
probe or the sign-in gate), renders honest distinct loading / ready / empty / unavailable / error
states, and the Board Pack gains a provider-only panel to create a link, copy the full URL exactly
once, and see existing links as metadata only with an early revoke.

### The honesty boundaries

The selling surface never fabricates and never leaks. The token's plaintext is shown once and never
stored, only its hash is, so the database cannot reconstruct a link; an invalid, expired, or revoked
token returns a uniform 404 that reveals nothing. The public projection is enforced in the type
(`PublicDiagnosisLayer` is an `Omit` of the internal fields) AND at runtime, so the cold link
exposes no owner persona, no diagnostic question, no layer feed graph, no raw connector data, and no
provenance. A case study is published only above the k-anonymity floor and carries no identity at
all, with small cohorts blurred and flagged rather than exposed. The voice evaluator measures and
reports, it never edits, so a below-bar narrative is shown at its real band rather than silently
corrected. The access telemetry (view count, last-accessed) is real, recorded only on a genuine
resolve. The architect `evaluate_task` first FAILED on one HIGH: the global error handler attached
`req.path` to the observability context, and for the public route the path contains the bearer share
token, so a failure deep in a public request could forward a live or attempted token to an external
Sentry-compatible sink even though the database stores only the hash. The fix is a single redaction
chokepoint (`redactRoute`) that collapses `/api/public/diagnosis/<bearer>` to the route template
before any capture, with a regression test proving the token substring never survives; the re-review
returned PASS. The accepted non-blocking drift is that the tenant case study is recomputed per public
hit rather than cached, correct and never stale but a latency consideration on the cold-link path at
scale.

### Verification

Typecheck and build green (exit 0; portal 1753 modules, api-server bundled); the full suite is green
at 758 tests (api-server 393 across 46 files including the new `shareTokens`, `caseStudies`,
`overviewProjection`, and `redactRoute` tests, portal 225 across 18 files including the new
`sellabilityApi` and `publicApi` tests, cortex 89 including the new `voice` editorial-quality tests,
connectors 29, edge-agent 10, db 8, scripts 4); the long-dash sweep is zero on both sides (the
source guard plus a database-wide cast over all 138 public text and jsonb columns, now including the
`diagnosis_share_tokens` text columns); zero new npm dependencies (the token is `node:crypto`; the
public page, clients, and routing are framework-free over the existing stack). The drift report is
`phase-AB.md`; the drift index and the rollup are updated to "A through AB". Phase AB is not a
milestone; per the owner-authorized Stage 4 run, execution continues to Phase AC (the Stage 4
verification and build-report close), after which the run PAUSES at the Stage 4/5 boundary for owner
review before Phase AD; the next protocol milestone hard stop is AI at the end of Stage 5.

## Phase AC: verification and the build-report append (closes Stage 4)

Phase AC is the closing phase of Stage 4 (Differentiation and Moat), run back to back with Y, Z, AA,
and AB under owner authorization. It built no product feature and changed no product code; like Phase
M closed Stage 2 and Phase V closed Stage 3, its only artifacts are the Stage 4 evidence matrix
(`docs/drift/phase-AC.md`), this build-report append, and the drift updates. It added zero npm
dependencies and contains no em-dash or en-dash in source or in data.

### What Stage 4 delivered

Stage 4 turned the diagnosis from a single-tenant artifact into a differentiated, defensible product
surface across four phases. Phase Y added the portfolio intelligence view: a ranked multi-tenant
board (value at risk, value identified versus realized, overall confidence, and the count and
severity of open gaps, worst and best surfaced to the top), cross-portfolio gap patterns, and a
drill-down into any bound tenant's full diagnosis, all fenced so a portfolio seat sees only its bound
tenants and is refused with a 403 on any tenant outside the portfolio. Phase Z added proactive push
intelligence: per-seat push rules and events distinct from the Phase P operations alerts, a scheduled
Morning Brief digest over email and Slack adapters that are available-not-connected until configured,
ranking by predicted dollar impact and confidence with low-impact signal suppressed, an in-app
notification center with read-state and mute, and an access-revoked event failed in place rather than
delivered. Phase AA added the interactive challenge: a seat challenges one finding and the objection
is re-reasoned through the Confounder and Synthesist seats, which uphold it with reasoning or revise
it with a new confidence and a `modelled_user_informed` basis, with the user's input as context and
never an override (a challenge can never delete a finding, a revise re-bases the challenge row only
and never the stored layer content), each exchange auditable and a completed challenge appending
exactly one hash-chained provenance entry. Phase AB added the sellability pack: a read-only,
summary-only shareable diagnosis link whose token is shown once and stored only as a sha256 hash,
anonymized segment-level case studies that reuse the Phase X k-anonymity and noise machinery and the
Phase W outcome math, a viral powered-by mark, and a deterministic editorial voice-quality
measurement at the narrate stage that records the score without ever editing the prose.

### What this phase verified

Each Stage 4 acceptance criterion is mapped in `phase-AC.md` to existing tested evidence with the
proof type marked honestly. The integration suite proves, against live Postgres, the portfolio access
fence and the 403 outside the portfolio, the push ranking and the exactly-once Morning Brief drain
and the revocation, the challenge route boundary (tenant fencing, the read-only seat refused a spend,
a blank or over-long or malformed challenge rejected before any model call, auth required to read the
history), and the benchmark recompute and owner-only routes. Deterministic unit tests prove the
portfolio, push, benchmark, and outcome math, the case-study k-anonymized aggregation, the voice
measurement (seven genuine checks, identical output for identical input, never an edit), the
share-token clamp and one-way hash and status, the public projection that strips the owner persona
and diagnostic question and layer feed graph in the type and at runtime, and the redaction chokepoint
that keeps a bearer share token out of the observability path. Three paths are honestly marked
source-reviewed rather than test-proven, the one accepted LOW for this phase: the challenge re-reason
engine (`runFindingChallenge`), which spends real Confounder and Synthesist model calls the suite
deliberately does not run, and the share-token mint and resolve and the unauthenticated public
diagnosis route, which have no dedicated route integration test. The pure helpers, the route boundary
and rejection cases, and the portal clients around these paths are all tested, and the case-study
loader's reuse of the SAME `computeOutcomeSummary` the `/outcomes` endpoint uses (so social proof can
never disagree with the outcome counter) is verified by source inspection. Two boundaries are honestly
not live: the external push sinks and the
durable secret and archive backends remain available-not-connected unless configured, and the
realized-value and benchmark figures were produced by earlier real runs and recomputed here, not by a
fresh paid model seed. No Stage 4 figure is fabricated: a value is computed from persisted state or
it is not shown.

### Verification

The global gates were re-run fresh for this phase. Typecheck and build are green across the workspace
(exit 0 on both; portal 1753 modules, api-server bundled). The full suite is green at 758 tests
(api-server 393 across 46 files, portal 225 across 18 files, cortex 89, connectors 29, edge-agent 10,
db 8, scripts 4); this phase added no tests and changed no product code. The long-dash sweep is zero
on both sides: the source guard is green over authored source including the Phase AB and AC Markdown,
and a fresh database-wide cast over all 138 public text and jsonb columns across 37 tables reports
zero hits. Zero new npm dependencies. The architect `evaluate_task` returned PASS. The drift report
is `phase-AC.md`; the drift index and the rollup are updated to "A through AC". Phase AC closes Stage
4 (Differentiation and Moat); per the owner-authorized Y-Z-AA-AB-AC run, the build now PAUSES at the
Stage 4/5 boundary for owner review before Phase AD and does not auto-advance. The next protocol
milestone hard stop is Phase AI at the end of Stage 5.

## Phase AD: full-application experience audit (opens Stage 5)

Phase AD opens Stage 5 (Platform completion). Per the binding Adaptation Guide it was RETIRED AS AN
OVERHAUL and run instead as a SHORT full-application experience AUDIT of the existing portal against
the design language (`docs/design-language.md`) and the AD acceptance set, FIXING DRIFT rather than
redesigning. The phase is presentation-only: it changed CSS, shared page-chrome classes, and
text-color token USAGE, and it reconciled the design-language document to the implementation. It added
no product feature and changed no route, schema, contract, or product logic, added and changed no
test, and added zero npm dependencies. The full suite stays at 758 tests, unchanged, which is the
regression proof for a presentation-only phase. There is no em-dash or en-dash in source or in data.

### What the audit fixed

Two of the seven acceptance items carried real drift. The CRITICAL one was 375px usability: the chrome
used inline padding and fixed widths that overflow a narrow phone viewport. Because inline style
objects outrank CSS classes on specificity, the fix converts the SHARED chrome to classes plus one
responsive layer rather than fighting hundreds of inline styles: `.page-width` (the shared measure),
`.top-nav-row` and `.top-nav-bar` (the top navigation), and `.table-scroll` (a horizontal-scroll
wrapper for wide tables), with an `@media (max-width: 480px)` block that reduces the chrome padding and
keeps the bottom navigation horizontally scrollable; the three core read pages (Morning Brief, a layer
page, Board Pack) wrap their wide tables in `.table-scroll`. Desktop rendering is visually equivalent.
The second was WCAG AA contrast: normal-sized tone text (good, warn, bad, neutral) rendered on the
base brand hues, which do not clear the 4.5:1 floor on the paper, cream, and faint-fill backgrounds at
normal size. The fix adds a tone-INK mapping (`toneInkVar`, `heroToneInkVar`) and routes every
normal-sized (under 24px) tone text through it, while the base hue is kept only where it is allowed:
large display figures at 24px and up (which clear the AA large-text floor), chart strokes, accent bars
and borders, icons, fills and backgrounds, status dots, and dark-surface text. Every ink shade was
verified against the actual background tokens with a deterministic Node contrast calculation (built-ins
only) and clears 4.5:1. A global `:focus-visible` ring (navy-soft) was added for keyboard visibility.

### What the audit confirmed and reconciled

The remaining items needed no code fix. Any diagnosis is two clicks from the portal entry and the first
insight is above the fold on the Morning Brief (both confirmed by source review). Every audited async
surface (Anomalies, War Room, Actions, Heartbeat, Notifications, Connections, Reasoning, Spend, and the
security child panels) already branches into distinct loading, empty, and error states through the
shared `DataState` primitive, with no fabricated data in any state, so the honest result is "audited,
no fix". The design-language doc was reconciled to the implementation in three places (the ink shades
and accessibility/responsive guidance added, the gold/eyebrow guidance corrected so base gold is for
accents and borders while small gold text including light-surface eyebrows uses gold ink and
dark-surface eyebrows use gold light, and the focus ring documented as navy-soft), and a stale code
comment was corrected. No unstyled default component was found.

### Verification

The global gates were re-run fresh for this phase. Typecheck and build are green across the workspace
(exit 0 on both; portal 1753 modules, api-server bundled). The full suite is green at 758 tests
(api-server 393 across 46 files, portal 225 across 18 files, cortex 89, connectors 29, edge-agent 10,
db 8, scripts 4), unchanged from Phase AC; this phase added no tests and changed no product code. The
long-dash sweep is zero on both sides: the source guard is green over authored source including the
Phase AD Markdown, and a fresh database-wide cast over all 138 public text and jsonb columns across 37
tables reports zero hits. Zero new npm dependencies. The architect `evaluate_task` returned PASS after
two remediation rounds. The drift report is `phase-AD.md`; the drift index and the rollup are updated
to "A through AD". The 375px usability proof is honestly source-reviewed (the responsive class and
media-query source plus the page markup), not a live-viewport capture, and the operator and admin
tables outside the core-read scope are not retrofitted; both are logged as accepted LOWs in the drift
report and the rollup. Phase AD opens Stage 5 (Platform completion) as the retired-overhaul experience
audit; per the owner authorization for this single phase, the build now PAUSES at the AD gate for owner
review before Phase AE and does not auto-advance. The next protocol milestone hard stop is Phase AI at
the end of Stage 5.

## Phase AE: the ingestion suite (five paths on one derive-and-discard core)

Phase AE is the ingestion stage of Stage 5 (Platform completion). It adds five inbound data paths that
ALL terminate at ONE shared derive-and-discard core, so no path can persist a raw artifact: the core
(`lib/ingestion/ingestCore.ts`) parses the inbound bytes or payload in memory, derives a
`DerivedSignalSet`, guards every signal's key, window, and unit as a non-identifying metric token at
this terminus (a violation is a mapped 400, not a 500), persists ONLY the derived math through the Phase
H connector terminus (`persistDerivedSignalSet`, so each value is per-tenant encrypted and the set
root-hashed), appends one provenance entry per target layer whose claim path records the ingestion method
and layer (the source ref is the derived-set root hash over the math only, never the raw artifact), and
discards the raw input. There is no raw-data store, no raw column, and no temporary raw file kept after
processing. Zero new npm dependencies; ASCII hyphen only in source and in data.

### What it does

The five paths are: (1) an ingestion API `POST /v1/ingest` gated by a per-tenant key held in
`ingestion_keys` as a scrypt hash only (the secret is shown once at mint, never stored in plaintext, is
revocable, and the miss path spends equal scrypt time so it does not leak validity by timing), rate
limited, with an OpenAPI document describing the contract; (2) per-source webhooks verified with a
timing-safe HMAC against a signing secret in `webhook_sources`; (3) manual upload where csv and xlsx
derive deterministic numeric math under generic positional keys (`column_<n>`, so a raw header label is
never echoed into a stored signal key; the human header rides only in the transient HTTP summary) and
pdf and docx contract text is extracted in the in-boundary seat and discarded leaving only numeric
metrics, with strict MIME, extension, and size gating and an honest derived-versus-discarded account;
(4) an SFTP drop with a per-tenant credential and an inbound-directory watcher that deletes each file
whether it succeeds OR is rejected (a rejected file is discarded with a loud logged reason, never parked
as a `.rejected` raw copy) and uses a quiet-period guard so a still-writing file is not processed; and
(5) an MCP server exposing `submit_signals` plus
`get_diagnosis`, `get_layer`, and `get_actions` under per-tenant auth. The portal Access console gains
an ingestion panel to mint and revoke ingestion keys and webhook sources with a one-shot secret reveal.

### The honesty boundaries

The central acceptance, that no path persists raw data, is test-proven: one integration test drives all
five paths with a single unique sentinel in each path's raw position, then sweeps every public text and
jsonb column across the whole schema plus the SFTP scratch directory and asserts the sentinel appears
nowhere. The five paths and the absence sweep run against live Postgres through the real app. The upload
contract path exercises the in-boundary extraction seat without spending a live frontier model, and
where that seat is unconfigured the established "available, not connected" honesty applies rather than a
fabricated metric. The portal ingestion admin client is source-reviewed (no new portal test), while the
server mint, revoke, and gate endpoints behind it are integration-tested; logged as an accepted LOW.

### Verification

The global gates were re-run fresh. Typecheck and build are green across the workspace (exit 0 on both;
portal built, api-server bundled). The full suite is green at 794 tests (api-server 429 across 52 files,
portal 225 across 18, cortex 89 across 11, connectors 29 across 5, edge-agent 10 across 3, db 8, scripts
4), up 36 from Phase AD's 758, all 36 in the six new api-server files (ingest 6, webhooks 5, upload 9,
sftpDrop 5, mcp 10, rawAbsence 1). The long-dash sweep is zero on both sides: the source guard is green
over authored source including the Phase AE Markdown, and a fresh database-wide cast over all 143 public
text and jsonb columns across 39 base tables (now including `ingestion_keys` and `webhook_sources`)
reports zero hits. Zero new npm dependencies. Two shared test-infrastructure faults surfaced by the
sixth DB-touching integration file were fixed: a real SFTP quiet-period age bug (an
integer-versus-sub-millisecond comparison that could skip a fresh file, now clamped at zero), and
intermittent pool-timeout 500s under the concurrent cross-package suite (the root `test` script now
serializes the per-package runs and `lib/db` caps the per-process pool small under the test runner; the
server default is unchanged). The architect's first review returned FAIL with four boundary-hardening
items at the derive-and-discard seam (the ingestion metadata-token guard, generic positional upload
keys, SFTP discard of a rejected file rather than a `.rejected` copy, and a strengthened raw-absence
test); all four were applied and the gate re-run green before the architect `evaluate_task` returned
PASS. The drift report is `phase-AE.md`; the drift index and the rollup are updated to "A through AE". Per the owner-authorized
AE-through-AI Stage 5 sequence, this phase does NOT pause at its own gate; execution continues to Phase
AF (local LLM seat and sovereign mode), whose acceptance needs a real local OpenAI-compatible model
endpoint that this container does not provide, so if none is available at the AF gate `docs/drift/STOP.md`
is written and the build pauses there. The next protocol milestone hard stop is Phase AI at the end of
Stage 5.

## Phase AF: the local LLM seat and sovereign mode

Phase AF is the local LLM seat and sovereign-mode phase of Stage 5 (Platform completion). It adds one
local OpenAI-compatible model seat and a single sovereign data mode that runs EVERY cortex stage
in-boundary on that local seat, so a tenant can run the whole cortex without any byte leaving the
deployment boundary. The existing outside_in and connected behaviour is preserved byte-for-byte, the
no-literal-model invariant holds (the local model id is a SEAT in `lib/cortex/src/config.ts`, never
inlined at a call site), and no telemetry, health, or output figure is fabricated. Zero new npm
dependencies; ASCII hyphen only in source and in data.

### What it does

Config gains a "sovereign" `CortexDataMode` resolved by a SINGLE switch, `resolveCortexDataMode(env)`
(`CORTEX_DATA_MODE=sovereign`), and a `runsOnLocal(stage, dataMode)` predicate that is `sovereign ||
runsInBoundary`; `IN_BOUNDARY_STAGES` and the outside_in and connected routing are unchanged. In
sovereign mode the orchestrator routes every stage through the local `ExtractionZoneRuntime` seam on one
threaded `StageContext`, so perceive, hypothesise, narrate, score, confound, and challenge all run on the
local seat. Confound and challenge still RUN in sovereign mode (the express reduction is held off by a
pure `reduceDecision`, so they are never silently skipped) but with grounding DROPPED rather than faked:
there is no Google Search channel in-boundary, so the run is honestly recorded ungrounded, and even
`seedTenant` uses a pure no-fetch homepage context so the profile too stays in-boundary. The cortex
records sovereign-only telemetry markers (`executionMode:"sovereign"`, `groundingAvailable:false`,
`webSearchAvailable:false`) only from a real run, applies a verified-to-modelled calibration in narrate
and score BEFORE persistence (so the downgraded output reaches the `sub_stages` jsonb and every
downstream consumer; in outside_in and connected the calibrator is the identity, so those paths are
unchanged), and fails LOUD if a sovereign run emits `verified_claims` rather than presenting a faked
verification channel. The portal `ReasoningStrip` surfaces "Reasoned in sovereign mode" and "External
grounding unavailable" only when a stage telemetry is sovereign, showing real model and token figures and
never a search or verified badge unless one is actually recorded.

### The honesty boundaries

The sovereign path is proven HERMETICALLY, with no live model, by an in-process OpenAI-compatible
conformance server and call spies: a connected run makes zero frontier calls from the extraction zone
(perceive and hypothesise), and a sovereign run makes zero external Anthropic or Gemini calls ANYWHERE,
with every stage running on the injected local runtime and confound and challenge not skipped. What is
NOT done here, and would be fabricated if claimed, is the real extraction quality of an actual local or
open model on the sovereign path and a local-only full seed of a real tenant end to end with real timings
and real token/cost telemetry: those need a running local OpenAI-compatible endpoint that this container
does not provide (`LOCAL_MODEL_*` unset, nothing listening, no GPU). No figure is fabricated to stand in
for them; the sovereign markers and model id are recorded only from a real run. The portal sovereign
surface (`ReasoningStrip.tsx`, the `types.ts` markers) is source-reviewed, not covered by a new portal
test, so the portal total stays at 225; the markers it reads are asserted at their source by the cortex
`sovereign-pipeline` test.

### Verification

The global gates were re-run fresh. Typecheck and build are green across the workspace (exit 0 on both;
portal built, api-server bundled). The full suite is green at 819 tests (api-server 433 across 53 files,
portal 225 across 18, cortex 110 across 13, connectors 29 across 5, edge-agent 10 across 3, db 8, scripts
4), up 25 from Phase AE's 794: in cortex, sovereign-pipeline 10 and calibration 7 (the new sovereign
routing and calibration files) plus four added to `homepageContext` during remediation; in api-server,
four `reduceDecision` tests added during remediation. The long-dash sweep is zero on both sides: the
source guard is green over authored source including the Phase AF Markdown, and a fresh database-wide cast
over all 143 public text and jsonb columns across 39 base tables (no schema added this phase) reports zero
hits. Zero new npm dependencies. The architect `evaluate_task` returned PASS after two remediation rounds
at the sovereign orchestration boundary: round one kept the express reduction off in sovereign mode via a
pure `reduceDecision`, labelled the narrate generator model from the call telemetry rather than config,
and threaded a calibrate seam into `executeStage`; round two actually applied that calibrate before
persistence, replaced the sovereign homepage fetch with a pure no-fetch context, and carried the real
model id and the sovereign markers through the folded enrichment telemetry; every finding was applied and
the gate re-run green before PASS. The drift report is `phase-AF.md`; the drift index and the rollup are
updated to "A through AF". Per the real-endpoint blocker, Phase AF PAUSES at its own gate: a
`docs/drift/STOP.md` records what is proven hermetically versus what needs a real endpoint (real
extraction quality, a local-only full seed with real latency and token/cost telemetry, plus the owner
rerun steps and missing env), and the build does NOT auto-advance to Phase AG without an owner. The next
protocol milestone hard stop is Phase AI at the end of Stage 5.

## Phase AG: the curated custom-layer creation flow

Phase AG is the fourth phase of Stage 5 (Platform completion), run under the owner-authorized
AE-through-AI sequence whose only milestone hard stop is Phase AI. (Phase AF paused at its own gate on the
real-endpoint blocker; the owner authorized proceeding, so AG resumes the sequence.) It makes the layer
registry extensible by the provider owner. The `layers` table has always been the single source of truth
for layer identity (there is no `LAYER_KEYS` constant anywhere; the pipeline, schemas, prompts, and portal
all read identity from this table), and Phase AG turns "custom layers are added as more rows later" from a
latent capability into a curated, owner-gated flow.

### What it does

A single predicate, `runnableLayerCondition()`, decides whether a layer is live: canonical OR an owner has
set its `approvedAt`. BOTH the seed fan-out (`orchestrator.loadRegistry`) and the portal catalog
(`GET /layers`) call this same predicate, so the set of layers that produce per-tenant output and the set
the portal lists can never disagree, and an unapproved custom layer is withheld identically from both.

The `layers` table gains an approval gate (`approvedAt` nullable timestamptz, `approvedBy` uuid
referencing `users.id` on delete set null) and an optional `benchmarkCanonicalKey` (nullable text,
self-referencing `layers.key` on delete set null); no new table, so the schema stays at 39 base tables and
the one added text or jsonb column is `benchmarkCanonicalKey`. A custom layer is created from
`customLayerTemplateSchema`, a `.strict()` Zod object that collects only the high-signal fields the
pipeline and hero need (name, diagnostic question, an archetype from the renderable set, EXACTLY four
metric tiles, at least one feed, plus optional honest extras) and therefore cannot be made to smuggle
`isCanonical`, `approvedAt`, or `sortOrder`. `buildCustomLayerRow` fills every uncollected field with an
honest, valid-but-empty default (description falls back to the diagnostic question, persona and hero
strings empty, the cause, action, and gap collections empty, `moduleGroup` "Custom") and runs the whole
row through `deepStripDashes` so no long dash reaches this new owner-supplied text sink; the row persists
`isCanonical=false` and `approvedAt=null`, so it runs nowhere until approved. `allocateLayerKey` and
`slugifyLayerKey` derive a stable, ASCII-only, hyphenated primary key, resolving any collision by
suffixing `-2`, `-3`, and so on with a loud timestamped last resort rather than a silent duplicate.

The routes are all owner-only (`requireOwner`): `POST /api/layers` (create; a supplied
`benchmarkCanonicalKey` must reference an existing canonical layer), `POST /api/layers/:key/approve`
(idempotent, sets `approvedAt` and `approvedBy`, returns `alreadyApproved`, refuses a canonical or a
missing key with distinct errors), `GET /api/layers/custom` (the owner console list), and the shared
`GET /api/layers` runnable catalog. The benchmark recompute (`benchmarks.ts`) honors the mapping honestly:
an unmapped custom layer is excluded from every cohort, and a mapped one pools under its canonical key, so
cohort membership is never fabricated. The renderable archetypes live in the portal hero `REGISTRY`
(exported as `ARCHETYPE_KEYS`) and the server validates against `ALLOWED_ARCHETYPES`; with no shareable
package, `customLayer.archetypeSync.test.ts` reads the portal registry SOURCE and asserts the two lists
are the same set, so they can never silently drift (currently nine renderable archetypes). The owner-only
Access console gains a "layers" tab (`CustomLayerPanel`) with a create form and a per-row approve action
and distinct honest loading, empty, and error states; the `adminApi` client gains the typed loaders and
writes.

### The honesty boundaries

A custom layer that has not run shows no per-tenant output; an unmapped custom layer claims no benchmark
membership; and the catalog lists a custom layer only once it is approved. The portal `CustomLayerPanel`
and the "layers" tab are the one accepted LOW, source-reviewed rather than test-proven, but the client
functions behind them ARE unit-tested and the routes ARE integration-tested; only the React rendering is
source-reviewed, mirroring the AE ingestion-panel and AF sovereign-surface items.

### Verification

Typecheck and build green across the workspace. The full suite is green at 853 tests (api-server 458
across 56 files, portal 234 across 18, cortex 110 across 13, connectors 29 across 5, edge-agent 10 across
3, db 8, scripts 4), up 34 from Phase AF's 819: api-server `customLayer` 15, `customLayer.archetypeSync` 1,
`layers.integration` 8, the `benchmarks.integration` guardrail (+1), and portal `adminApi` (+9). The
long-dash sweep is zero on both sides: the source guard is green over authored source including this Phase
AG Markdown, and a fresh database-wide cast over all 144 public text and jsonb columns across 39 base
tables reports zero hits. Zero new npm dependencies. The architect `evaluate_task` returned PASS on the
first pass with no findings. The drift index, the rollup, and this build report are updated to "A through
AG". Per the owner-authorized AE-through-AI sequence Phase AG does NOT pause at its own gate; execution
continues to Phase AH. The next protocol milestone hard stop is Phase AI at the end of Stage 5.

## Phase AH: cloud portability

Phase AH is the fifth phase of Stage 5 (Platform completion), run under the owner-authorized
AE-through-AI sequence whose only milestone hard stop is Phase AI. It makes the deployment portable off
this single managed host without changing one product guarantee: it adds a second cloud target for each
"available, not connected" seam (AWS alongside the existing GCP), proves the seed queue is safe across
more than one running instance, and writes the deploy artifacts so an owner can stand the system up on
their own infrastructure. Zero new npm dependencies (node:crypto and the Node global fetch only, no AWS
SDK); ASCII hyphen only in source, in data, and in these documents.

### The shared SigV4 signer

One zero-dependency AWS Signature Version 4 signer (`artifacts/api-server/src/lib/aws/sigv4.ts`, built on
`node:crypto` alone) is shared by both AWS adapters so the signing logic lives in exactly one place. The
canonical URI is single-encoded for `s3` and double-encoded for every other service, the query string is
sorted, the signed headers are lowercased, trimmed, and sorted, `host` and `x-amz-date` are always signed
with an optional `x-amz-security-token`, and the payload is hashed with sha256 (so a write-once
`If-None-Match` header is part of the signed set for the S3 path). Credentials resolve lazily from
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and the optional `AWS_SESSION_TOKEN`; their absence throws a
precise error rather than signing with empty keys. The signer is pinned by a golden test against AWS's
published IAM `ListUsers` example vector plus a property test for each canonicalization rule.

### The two cloud adapters

The AWS Secrets Manager adapter (`lib/secrets/awsSecretsManagerSecretStore.ts`) mirrors the Phase Q GCP
adapter exactly: available-not-connected until a region is set (the first call throws "AWS Secrets Manager
is available, not connected: set AWS_SECRETS_MANAGER_REGION (or AWS_REGION) to connect it."), the full
`GetSecretValue` / `CreateSecret` / `PutSecretValue` / `DeleteSecret` surface over the signer and the
global fetch, a `ResourceNotFoundException` mapped to null on read and tolerated idempotently on delete,
and no value, token, or body ever logged. Critically it uses the SAME `[A-Za-z0-9_-]{1,255}` ref grammar
as the GCP adapter, so a secret reference (a tenant `authRef`) is byte-identical across providers and
stays portable when the backend changes. `getSecretStore` selects it with `SECRET_STORE_PROVIDER=aws`.

The S3 archive adapter (`lib/backups/s3ArchiveStore.ts`) is the AWS sibling of the Phase U GCS adapter:
available-not-connected until `S3_ARCHIVE_BUCKET` is set, `put` / `get` / `list` / `describe` over the
signer and fetch, where `describe` reports only `{ provider: "s3", connected }` and never a bucket, path,
or credential, so the owner-only backup status route stays non-secret. Write-once is enforced with the
`If-None-Match: *` precondition S3 honours: a second write to a key returns 412 and is surfaced loudly
rather than overwriting, preserving the ledger archive's immutability. The endpoint is overridable so the
tests drive it path-style against an injected fetch with no live bucket. `createArchiveStore` selects it
with `ARCHIVE_STORE_PROVIDER=s3`.

### Multi-instance queue ownership

The `pipeline_jobs` seed queue has always claimed each job with `FOR UPDATE SKIP LOCKED`. Phase AH adds an
integration test that stands up two distinct instance ids, each running its own worker pool, both draining
one tenant's queue at once, and asserts every layer is claimed by exactly one worker, the count of
terminal rows equals the count of input jobs (nothing dropped or duplicated), and the work is observably
distributed across both instances. This documents the operational contract: `LAYER_CONCURRENCY` is the
per-instance worker count, so fleet-wide parallelism is `instances * LAYER_CONCURRENCY`, and no fleet-wide
ceiling is claimed because the queue itself, not a coordinator, is the safety boundary.

### The deploy artifacts

A multi-stage `Dockerfile` builds the workspace on `node:22-bookworm-slim` with the repo's pinned pnpm
(portal built to `dist/public`, api-server bundled to `dist/index.mjs`) and runs `node
artifacts/api-server/dist/index.mjs` as a single twelve-factor process that serves both the API and the
built portal (`PORTAL_DIST_DIR`), with a `HEALTHCHECK` on `/health`. The api-server already served the
built portal when `PORTAL_DIST_DIR` is set, excluding the `/api`, `/v1`, and `/mcp` namespaces from the
SPA fallback and returning a JSON 404 for an unknown API path; Phase AH adds the integration test pinning
this. A `docker-compose.yml` is the local-parity stack (a `postgres:16-bookworm` database, a one-shot
migrate running `pnpm --filter @workspace/db push`, the app, and an optional seed profile),
`infra/gcp/*.tf` is a minimal executable GCP target (Cloud Run v2 with a `roles/run.invoker` grant to
`allUsers`, gated by the `allow_unauthenticated` variable that defaults to true, so the service URL is
reachable by a browser while the app keeps its own application-layer authorization; Cloud SQL Postgres 16;
Secret Manager for `SESSION_SECRET` and `OWNER_PASSWORD` via `SECRET_STORE_PROVIDER=gcp`; a `DATABASE_URL`
secret env over the `/cloudsql` socket; and a GCS bucket), and `docs/migration-runbook.md` documents the GCP primary path,
the AWS equivalent, the drizzle migration, and the cutover and rollback. These artifacts are written and
ASCII-verified but NOT built here.

### The honesty boundary: proven here versus owner must run on a Docker host

Test-proven here through the workflows: the SigV4 signer against AWS's vector and the canonicalization
properties, both cloud adapters' full surface and available-not-connected behaviour over an injected
fetch, the cross-provider portable ref grammar, the S3 write-once 412, the queue's exactly-once guarantee
across two simultaneous instances against real Postgres, and the single-process portal-plus-API serving
with the API namespaces protected from the SPA shell. NOT done here and the owner's to run (claiming any of
it would be fabrication): `docker build` and `docker compose up` (no Docker daemon in this container), a
full in-container demo seed (needs a Docker host plus live model provider credentials, and a live frontier
seed is deliberately not re-run for cost), a live AWS or GCP run of the available-not-connected adapters
(needs real credentials and a bucket the owner provisions), and `terraform apply` of `infra/gcp` plus the
durable Postgres and point-in-time recovery the platform owns.

### Verification

Typecheck and build green across the workspace. The full suite is green at 888 tests (api-server 493
across 58 files, portal 234 across 18, cortex 110 across 13, connectors 29 across 5, edge-agent 10 across
3, db 8, scripts 4), up 35 from Phase AG's 853, all in api-server (56 to 58 files): sigv4 9 and
portalStatic.integration 5 (two new files), the AwsSecretsManagerSecretStore describe (+9) in secretStore,
the two S3ArchiveStore describes (+10) in archiveStore, and the multi-instance queue cases (+2). The
long-dash sweep is zero on both sides: the source guard is green over authored source including this Phase
AH Markdown, and a fresh database-wide cast over all 144 public text and jsonb columns across 39 base
tables (no schema added this phase) reports zero hits. Zero new npm dependencies. The architect
`evaluate_task` returned PASS after one remediation round: the first review flagged a single deploy-artifact
blocker (the GCP Terraform created the Cloud Run service and output its URL but granted no
`roles/run.invoker`, so the URL would have rejected every browser and the runbook's `GET /health` smoke
test), which was fixed by adding a gated `roles/run.invoker` grant to `allUsers` plus the access-model
documentation, after which the three workflow gates were re-run green. The drift index, the rollup, and
this build report are updated to "A through AH". Per the owner-authorized AE-through-AI sequence Phase AH does NOT pause at its own gate; execution
continues to Phase AI, the final phase of Stage 5 and the next protocol milestone hard stop.

## Phase AI: verification and the build-report append (closes Stage 5)

Phase AI is the closing phase and milestone of Stage 5 (Platform completion), the end of the
owner-authorized AE-through-AI sequence. It built no product feature and changed no product code; like
Phase M closed Stage 2, Phase V closed Stage 3, and Phase AC closed Stage 4, its only artifacts are the
Stage 5 evidence matrix (`docs/drift/phase-AI.md`), this build-report append, and the drift updates. It
added zero npm dependencies and contains no em-dash or en-dash in source or in data.

### What Stage 5 delivered

Stage 5 turned a finished single-host product into a complete, portable, self-serviceable platform across
five phases. Phase AD audited the full application against the design language and fixed the drift it
found without an overhaul: shared responsive chrome so the read pages stay usable at 375px, a tone-to-ink
mapping so normal-sized tone text clears WCAG AA contrast, and a global focus ring, with the
design-language doc reconciled to the implementation. Phase AE added the ingestion suite: five inbound
data paths (a per-tenant key gated ingestion API with an OpenAPI document, timing-safe HMAC webhooks, a
strict-MIME manual upload that keys numeric data positionally so a raw header never lands in a stored
key, an SFTP drop that deletes every file whether processed or rejected, and an MCP server under
per-tenant auth) on ONE shared derive-and-discard core that persists only the derived math and keeps no
raw store, raw column, or lingering raw file, proven system-wide by a unique-sentinel sweep. Phase AF
added the local LLM seat and a single sovereign data mode that runs every cortex stage in-boundary on the
local seat, with confound and challenge still running but grounding honestly dropped, sovereign-only
telemetry recorded only from a real run, and a fail-loud guard against a faked verification channel,
proven hermetically because this container has no local model endpoint. Phase AG added the curated
custom-layer creation flow: an owner-gated layer lifecycle where one shared runnable predicate gates both
the seed fan-out and the portal catalog so an unapproved custom layer runs nowhere and the two can never
disagree, with an optional benchmark mapping that pools a mapped layer under its canonical key and
excludes an unmapped one so a cohort is never fabricated. Phase AH made the deployment portable off this
single managed host: a shared zero-dependency AWS SigV4 signer, an AWS Secrets Manager and an S3 archive
adapter mirroring the GCP and GCS ones with the SAME portable ref grammar and write-once semantics, a
proof that the queue claims each job exactly once across more than one instance, and the deploy artifacts
(a multi-stage Dockerfile, a local-parity compose file, executable GCP Terraform with the invoker
binding that makes the Cloud Run URL reachable, and a migration runbook).

### What this phase verified

Each Stage 5 acceptance criterion is mapped in `phase-AI.md` to existing tested evidence with the proof
type marked honestly. The integration suite proves, against live Postgres, the five ingestion paths and
the system-wide raw-artifact absence sweep, the custom-layer create and owner-only approve and catalog
gating, the queue claiming each job exactly once across two simultaneous instances, and the
single-process portal-plus-API serving. Deterministic unit tests prove the AWS SigV4 signer against AWS's
published vector, the custom-layer template validation and the archetype lockstep guard, and the
benchmark cohort math. Sovereign mode is proven hermetically by an in-process conformance server and
spies with no live model (connected makes zero frontier calls from the extraction zone; sovereign makes
zero external calls anywhere, every stage on the local runtime, confound and challenge not skipped). Two
classes are honestly not live here and are verified as honest seams: the AWS, S3, GCP, and GCS adapters
are available-not-connected unless their env is configured, and the deploy artifacts are ASCII-verified
but not built because this container has no Docker daemon. Two paths are honestly marked source-reviewed,
the accepted LOWs: the portal ingestion admin client and the portal custom-layer panel, whose server
endpoints and client functions are tested. The owner-rerun boundary carried out of Stage 5 is the
sovereign real-endpoint full seed (AF) and the Docker build, full in-container seed, live cloud run, and
`terraform apply` (AH), all recorded honestly rather than faked. No Stage 5 figure is fabricated: a value
is computed from persisted state or it is not shown.

### Verification

The global gates were re-run fresh for this phase. Typecheck and build are green across the workspace
(exit 0 on both; portal 1756 modules, api-server bundled to `dist/index.mjs`). The full suite is green at
888 tests (api-server 493 across 58 files, portal 234 across 18 files, cortex 110 across 13 files,
connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4); this phase added no tests
and changed no product code. The long-dash sweep is zero on both sides: the source guard is green over
authored source including the Phase AH and AI Markdown, and a fresh database-wide cast over all 144
public text and jsonb columns across the 39 base tables reports zero hits; the Terraform and the root
Dockerfile, which the source guard's roots do not cover, were verified ASCII by hand. Zero new npm
dependencies. The architect `evaluate_task` returned PASS. The drift report is `phase-AI.md`; the drift
index and the rollup are updated to "A through AI". Phase AI closes Stage 5 (Platform completion) and is
the final milestone of the owner-authorized AE-through-AI sequence; the build now PAUSES at the Phase AI
milestone for owner review and does not auto-advance.

## Phase AJ: the Brier-scored calibration ledger (milestone)

Phase AJ supersedes Phase W's loose calibration (a raw hits-over-resolved count) with a proper
probabilistic scoring rule. The real Evaluator seat now states a likelihood for each binary,
resolvable claim it makes; that probability is stored once at seed time and, when the claim later comes
true or false, scored with the Brier score (the mean squared error of a probabilistic forecast: 0 is
perfect, 1 is perfectly wrong, the always-0.5 forecaster exactly 0.25). The calibration surface reads
every aggregate against that 0.25 baseline, labels a thin sample honestly, and shows the resolved
ledger with misses always included. Zero new npm dependencies; ASCII hyphen only in source and in data;
no fabricated telemetry; the Evaluator stays a SEAT (no model literal in source); and crucially no
verdict-to-probability mapping, no fallback probabilities, and no title-based action linking.

### What this phase built

One `forecasts` table (the only schema change; the base-table count goes from 39 to 40) holds one row
per probabilistic forecast across all five kinds (`action_outcome`, `risk_occurrence`,
`anomaly_materiality`, `finding_survival`, `confounder_verdict`), with the honesty boundary in the
column nullability: `probability` (numeric(5,4)) is set from the real Evaluator output at creation,
while `outcome`, `resolvedAt`, `brierScore`, and `resolutionBasis` (its own enum of measured, modelled,
owner) stay null until the forecast actually resolves. The foreign keys encode the lifecycle (tenant
cascade, layer restrict, committed action and outcome measurement and resolving owner all set null), so
the graded row outlives the operator who adjudicated it. The pure Brier math
(`artifacts/api-server/src/lib/calibration/brierMath.ts`) is `(p - o)^2` with the probability clamped,
a fixed 0.25 baseline, an empty-set null mean (never a fabricated zero), a per-segment aggregation, a
ten-band calibration curve with null empty bands, an honest sample label, and a downward-only,
threshold-gated, never-inflating confidence calibration; the honesty thresholds live in one
`config.ts`. The cortex score stage gains an optional `forecasts[]` that the REAL Evaluator emits as
genuine likelihoods (no synthesis from a verdict string), and the orchestrator persists them only after
the real score stage succeeds, with `resolveBy` set to made-at plus the horizon. The resolution service
is the single honest writer: an `action_outcome` forecast is linked to its committed action by an
EXPLICIT id-or-anchor reference (never a title match), resolves automatically only on a TERMINAL outcome
measurement (realized to 1, missed to 0; pending or on_track leaves it open) with the basis carried from
the measurement, or resolves by an owner adjudication whose Brier score is computed server-side from the
stored probability under an unresolved-row guard that prevents a double-resolve. The `/api/calibration`
route (behind `requireAuth`) returns the headline Brier against the baseline, the curve, the per-layer,
per-kind, and per-seat breakdowns with labels, the resolved and open counts, and the resolved ledger
with misses always included; the summary is tenant-scoped for any seat that can reach the tenant and
owner-only system-wide, and the owner-only resolve route maps to 200, 404, or 409. The display-only
`computeLayerConfidenceAdvisory` reads a layer's own resolved forecasts and returns a disciplined
confidence alongside the raw value and the evidence, never overwriting the raw pill. The portal
`CalibrationPage` renders the headline with a plain-English explainer, a no-dependency calibration
curve, the breakdown tables, honest sample labels, and the visible ledger, with distinct loading,
empty, error, and ready states and a dash (never a zero) for a missing figure.

### Verification

Typecheck and build are green across the workspace (exit 0 on both; portal built, api-server bundled).
The full suite is green at 923 tests (api-server 522 across 60 files, portal 240 across 19 files, cortex
110 across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4), up 35
from Phase AI's 888; the new tests are api-server `brierMath` (20) and `calibration.integration` (9)
plus portal `calibrationApi` (6). The long-dash sweep is zero on both sides: the source guard is green
over authored source including the Phase AJ Markdown, and a fresh database-wide cast over all 150 public
text and jsonb columns across the 40 base tables (the `forecasts` table is the one added) reports zero
hits. Zero new npm dependencies. The architect `evaluate_task` returned PASS, confirming the Brier math
and aggregation, the honesty boundary (no probability synthesised from a verdict string or defaulted),
the resolution path (no double-resolve, owner-only adjudication, explicit id-or-anchor action linking),
and the route authorization, with the hard constraints holding. The accepted LOWs are source-reviewed
and logged in `phase-AJ.md`: the score prompt that elicits the likelihoods runs only inside a real paid
Evaluator call the suite does not run (the output schema carrying `forecasts[]` and the orchestrator
persistence ARE test-proven through the real output shape), and the `CalibrationPage` React rendering
(its `calibrationApi` client is unit-tested and its route is integration-tested). The drift report is
`phase-AJ.md`; the drift index and the rollup are updated to "A through AJ". Phase AJ is a MILESTONE hard
stop: the build now PAUSES at the AJ gate for owner review and does NOT auto-advance to Phase AK.

## Phase AK: the Data Efficacy Index

### What this phase built

Phase AK opens Stage 6 (the final stage) under owner authorization, the AJ milestone pause having been
cleared to run the Stage 6 sequence (AK, AL, AM, AN) linearly. It answers a question the confidence band
does not: confidence is how sure the reasoning is, efficacy is how good the data feeding it is. A
per-layer, per-tenant 0-to-100 Data Efficacy Index is computed entirely at READ time from already-persisted
state (no schema is added; the base-table count stays 40), mirroring the Phase O `connectionHealth` pattern
so the index can never drift from the data it describes. The index is a weighted average of five named
drivers, with the weights and tunables in one documented, env-overridable config
(`artifacts/api-server/src/lib/efficacy/config.ts`, defaults coverage 0.25, freshness 0.15, verification
rate 0.25, adversarial survival 0.15, source diversity 0.20, summing to 1.0 and renormalized; per-weight
`EFFICACY_WEIGHT_*` overrides, a freshness half-life `EFFICACY_FRESHNESS_THRESHOLD_SECONDS` default 86400
and max-age multiple default 4, and a diversity target default 5, with a `feedAliasMap` that bridges the
registry feed labels to connector families so the coverage denominator is honest about which feeds are even
connectable). The pure `efficacyMath.ts` composes the index: a null driver is `not_measured`, shown as a
dash and accruing disclosed `unknownWeight` rather than counted as a zero; the outside-in ceiling is
enforced in the math (the connector-grounded drivers coverage and freshness are mode-capped to zero
contribution in `outside_in` so the score can never exceed `modeCeiling = round((1 - coverageWeight -
freshnessWeight) * 100)`, while connected reaches 100), so a stray connected signal can never lift an
outside-in layer past its ceiling; `cheapestImprovement` names the single highest-lift next lever; and
`rollupEfficacy` means the per-layer scores or returns null for an empty set. The read-time service
(`efficacyService.ts`) mirrors `connectionHealth` and stores nothing: a pure `buildLayerEfficacy` wires the
database reads (declared feeds, verified-versus-modelled claim counts, confounder verdicts, reduced-mode
flag, derived-signal source keys and `computedAt`) into the math, and `loadLayerEfficacy`,
`loadTenantEfficacy` (the rollup, mean across generated layers), and `loadEfficacyForTenants` (the
portfolio batch) run the queries. The layer-detail route returns `efficacyIndex` beside the confidence
band, `GET /api/tenants/:id/efficacy` (behind `requireTenantAccess`) returns the tenant rollup, the
portfolio board rows carry `efficacyScore`/`efficacyLayers`, and `portfolioMath` adds an `efficacyRank`
(the best-fuelled company leads, a null score sorts last) as a second ordering on the value-ranked board.
The portal adds the efficacy types, a framework-free `efficacyApi.ts` client (401 to an unauthorized
state, a payload without a rollup and a layers array treated as malformed), and the surfaces:
`TenantEfficacyRollup` and a per-layer `EfficacyNote` on `LayerPage` (the cheapest-improvement hint and the
outside-in ceiling shown when capped), the Board Pack tenant summary, and the Portfolio efficacy column,
each with distinct loading, ready, and error states and a dash, never a fabricated zero, for a not-measured
figure.

### Verification

Typecheck and build are green across the workspace (exit 0 on both; portal built, api-server bundled). The
full suite is green at 956 tests (api-server 549 across 62 files, portal 246 across 20 files, cortex 110
across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4), up 33 from
Phase AJ's 923; the new tests are api-server `efficacyMath` (19) and `efficacyService` (7) plus one added
`portfolioMath` case, and portal `efficacyApi` (6). The long-dash sweep is zero on both sides: the source
guard is green over authored source including the Phase AK Markdown, and a fresh database-wide cast over
all 150 public text and jsonb columns across the 40 base tables (no schema is added in AK) reports zero
hits. Zero new npm dependencies. The architect `evaluate_task` returned PASS after one remediation round
that addressed three findings: the outside-in mode ceiling is now enforced in both the pure math and the
read-time service (the mode-capped drivers forced to zero contribution so a stray connected signal can
never lift a layer past its ceiling), the portal efficacy surfaces carry distinct honest states and a dash
rather than a fabricated zero, and the env-override behaviour of the five weights is covered by the tests;
the review confirmed the index computes from real drivers, the drivers and the hint render, connecting a
feed or resolving a confounder moves the score, outside-in and connected differ honestly, and the hard
constraints hold. The accepted LOWs are source-reviewed and logged in `phase-AK.md`: the read-time SQL
loaders and the efficacy routes have no dedicated integration test (the pure driver wiring, the index math,
and the portfolio ranking behind them ARE unit-tested), and the portal efficacy rendering (its `efficacyApi`
client is unit-tested). The drift report is `phase-AK.md`; the drift index and the rollup are updated to
"A through AK". Phase AK is not a milestone; the build advances to Phase AL (the decision ledger and
pre-mortem).

## Phase AL: the decision ledger and pre-mortem

### What this phase built

Phase AL is the second phase of Stage 6 (the final stage), run under the owner authorization that cleared
the AJ milestone pause to execute the AK-AL-AM-AN sequence linearly. It turns the platform from an advisor
that talks into an advisor that is held to account: where Phase AK measured how good the DATA feeding a
layer is, Phase AL records what a board DECIDES against the intelligence and grades those decisions over
time. Three things land together on three new tables (`decision_records`, `pre_mortems`,
`pre_mortem_indicators`, taking the base-table count from 40 to 43): a decision ledger, an on-demand
pre-mortem, and a board-grade decision audit timeline. The decision ledger holds one hash-chained row per
commit, defer, or reject (`decision_kind`), snapshotting the system recommendation and its confidence and
basis AT THAT MOMENT (`recommendationHash` binds the row to the exact recommendation it acted on), the
provenance refs grounding the layer at decision time (`evidenceRefs`, references into the append-only
ledger, never raw evidence, an empty array the honest state for an ungraded outside-in layer), whether
that snapshot was read SERVER-SIDE or came from the client (`recommendationVerified`), the human's
rationale (hashed into the provenance digest, never embedded raw), the linked AJ forecast, and whether the
decision contradicted the advice (`contradictsRecommendation`, computed once at decision time). A decision
is a recorded human act, so it ALWAYS appends exactly one provenance entry; `recordDecisionTx`
(`lib/decisions/decisionRecord.ts`) runs inside the caller's transaction, hashes the canonical
recommendation and the canonical evidence set into the entry, and inserts the row. Two honesty gaps from
the first architect review are closed here: the commit route (`POST /tenants/:id/actions`) now reads the
recommendation server-side by `actionRef` BEFORE the write transaction (`loadRecommendationSnapshot`,
returning `404 layer_not_found`, `404 action_not_found`, `422 not_an_action` before any action is written)
and snapshots the verified SERVER recommendation so a board audit can never present a client-typed action
as a system one (a freeform no-ref commit keeps the client snapshot, honestly `recommendationVerified=false`),
and `snapshotLayerEvidence` captures the latest ledger entry per claimPath under the layer EXCLUDING the
decision, challenge, and pre-mortem meta prefixes so the audit shows exactly what grounded the advice even
after the layer is refreshed. The on-demand pre-mortem (`lib/decisions/preMortem.ts`, `runDecisionPreMortem`)
mirrors the Phase AA interactive challenge: a REAL Confounder cortex call (`runPreMortem`, with its prompt
and strict output schema in `lib/cortex/src`), real billed telemetry through `recordModelUsageSafe`, and an
honest completed-or-failed lifecycle. A completed run writes, in a single transaction, the ranked failure
modes (each `{ rank, title, mechanism, likelihood, earlyWarning }`), the residual-risk note, one
hash-chained provenance entry, and one watched indicator per failure mode in `pre_mortem_indicators`; a
failed run writes an honest `failed` row with the error and the real telemetry and NO provenance and NO
indicators, never a fabricated forecast of doom. The indicators are wired to the Phase Z `premortem_indicator`
push rule (`pushEvaluator.ts`, `pushMath.ts`) with a `premortemIndicatorDedupeKey(indicatorId, status)` so a
status change mints a fresh notification while an unchanged active indicator never notifies twice, and the
owner or provider moves an indicator through `active`, `triggered`, and `cleared`. The board-grade audit
timeline (`lib/decisions/timeline.ts`, `getDecisionTimeline`) joins the ledger to its pre-mortems and
indicators, the committed action each commit created, that action's latest graded outcome, and the AJ
forecast it concerns, computing every figure from persisted state: the running realised value
(`runningRealizedValue`, pure) is the cumulative sum of only terminal graded measurements in chronological
order (a pending decision carries the prior cumulative forward, never a projection), and "overruled and
right" (`deriveOverruledStatus`, pure) is derived at read time, never stored, so a contradicting decision
reads `right` when its `action_outcome` forecast later resolves FALSE, `wrong` when it resolves TRUE, and
honestly `pending` until then. The routes (all behind `requireTenantAccess`, a client-viewer forbidden from
recording a decision or spending a Confounder call) are `POST /tenants/:id/decisions` (defer or reject),
`POST /tenants/:id/decisions/:decisionId/pre-mortem`, `GET /tenants/:id/decisions/timeline`, and
`POST /tenants/:id/pre-mortem-indicators/:indicatorId/status`, plus the upgraded commit route. The portal
adds the decision, pre-mortem, indicator, and timeline types, a framework-free `decisionApi.ts` client (401
to an unauthorized state), and the `DecisionsPage` and `DecisionControl` surfaces (the recommendation at the
time with a verified-or-unverified pill, the evidence-ref count, the pre-mortems and their watched
indicators, the overruled verdict, and the running realised value), each with distinct loading, ready,
empty, and error states and a dash, never a fabricated zero, for a missing figure.

### Verification

Typecheck and build are green across the workspace (exit 0 on both; portal built, api-server bundled). The
full suite is green at 1005 tests (api-server 581 across 65 files, portal 263 across 21 files, cortex 110
across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4), up 49 from
Phase AK's 956; the new tests are api-server `decisionRecord` (5, the recommendation and evidence
canonicalisation and hashing and the `contradictsRecommendation` derivation), `timeline` (10, the pure
`runningRealizedValue` and `deriveOverruledStatus` math), and the `decisions.integration` suite (17,
against live Postgres with real hash-chained provenance: the commit server-snapshot overriding a wrong
client description, the exact latest-per-claimPath evidence snapshot with the meta entries excluded, the
commit and defer guard paths failing before any write, the no-ref unverified commit, the defer snapshot and
overruled mark, the timeline read with seeded pre-mortems and the overruled verdict, the pre-mortem and
indicator route guards, and the indicator status transitions), plus portal `decisionApi` (17). The
long-dash sweep is zero on both sides: the source guard is green over authored source including the Phase AL
Markdown, and a fresh database-wide cast over all 169 public text and jsonb columns across the 43 base
tables (three tables added in AL) reports zero hits. Zero new npm dependencies (the pre-mortem reuses the
existing Confounder seat). The architect `evaluate_task` returned PASS after one remediation round that
closed two blocking gaps: the decision now snapshots the provenance evidence the recommendation rested on
(`evidenceRefs` plus `recommendationVerified`, `snapshotLayerEvidence` keeping the latest entry per
claimPath and excluding the meta prefixes, the canonical evidence set hashed into the decision's provenance
entry), and the commit route reads the recommendation server-side by `actionRef` before the write
transaction (the 404 and 422 guards before any write) and snapshots the verified server recommendation; the
re-review confirmed the ledger is hash-chained and binds to the exact recommendation and evidence, the
pre-mortem is a real Confounder call with an honest completed-or-failed lifecycle whose indicators feed the
push rule, the timeline derives the running realised value and the overruled verdict from persisted state,
and the hard constraints hold. The accepted LOWs are source-reviewed and logged in `phase-AL.md`: the
on-demand pre-mortem's real Confounder call runs only inside a real paid model call the suite does not run
(the route guards, the failed-run row, the indicator wiring, and the timeline rendering of a seeded
completed pre-mortem ARE tested), and the portal decision surfaces (`DecisionsPage`, `DecisionControl`) are
source-reviewed (the `decisionApi` client behind them is unit-tested). The drift report is `phase-AL.md`;
the drift index and the rollup are updated to "A through AL". Phase AL is not a milestone; the build
advances to Phase AM (the as-of replay and the diligence pack).

## Phase AM: the as-of replay and the diligence pack

### What this phase built

Phase AM is the third phase of Stage 6 (the final stage), run under the owner authorization that cleared the
AJ milestone pause to execute the AK-AL-AM-AN sequence linearly. It gives the platform a memory and a way to
hand that memory to an outsider. Two things land together on ONE new table (`tenant_layer_snapshots`, taking
the base-table count from 43 to 44): an as-of replay read-model and a diligence pack export. The as-of
snapshot ledger exists because `tenant_layers` is upserted in place, so a refresh overwrites the prior
narrative, claim split, and confounder verdicts; without an immutable per-build ledger a past diagnosis
could not be reconstructed and an as-of view would have to fabricate it. `tenant_layer_snapshots` holds one
APPEND-ONLY row per layer build, written ATOMICALLY with the `tenant_layers` upsert in the same transaction
and at the same instant from the SAME dash-stripped row: the content fields mirror the live row,
`rawConfidence` is captured for the confidence advisory, `contentHash` is a sha256 over a canonical
stable-key serialisation of the content payload (the fingerprint the diff compares), `dataMode` and `feeds`
are the build-time mode and feed list, and `signalMeta` is the connected-signal metadata that grounded the
build (per source, its connector key and `computedAt`, the same de-identified pair already in
`derived_signals`, never raw content). The efficacy index is deliberately NOT stored; it is recomputed at
read time from the snapshot's own inputs so it can never drift. `buildTenantAsOf` reconstructs a tenant's
state as of a past instant from append-only, timestamped state only: per layer the latest snapshot at or
before the date (a layer with no build by then is honestly unavailable, never a fabricated empty diagnosis),
the efficacy recomputed from that snapshot's captured mode, feeds, claims, confounders, and signal metadata
(so a later refresh that delete-replaces the live `derived_signals` cannot rewrite a past connected build's
coverage or freshness), and the confidence advisory recomputed from the forecasts resolved by the as-of
date. The diff is snapshot to snapshot (`diffLayerSummaries`, pure): content-changed by hash, every delta
current minus as-of and null (never zero) unless both sides carry the figure, plus honest tenant-level
growth (ledger depth as of the date versus now, decisions and outcomes since). The diligence pack
(`buildDiligencePack`, `renderDiligencePackHtml`) is a single self-contained brand-styled HTML document
assembled from the same persisted state the live surfaces read (`loadTenantEfficacy`, `getDecisionTimeline`,
`verifyChain`, the calibration aggregate, the confidence advisory): the current 14-layer diagnosis with
verified counts beside modelled counts, the efficacy and calibration record with the honest mode ceiling and
sample label, the board-grade decision audit timeline with the overruled verdict off the exact
`deriveOverruledStatus` contract, the outcome track record (value identified versus realized), and a
provenance integrity attestation that flags a broken chain rather than asserting integrity, with every
tenant-controlled string HTML-escaped. The render is a PURE function built by hand with zero new
dependencies. Both surfaces are read-only over append-only state and state plainly that history cannot be
edited through them. The routes (behind `requireTenantAccess`, both GET) are `GET /tenants/:id/as-of?at=<ISO>`
(400 on a bad date, 404 on an unknown tenant) and `GET /tenants/:id/diligence-pack.html` (inline
self-contained HTML). The portal adds the as-of types, a framework-free `replayApi.ts` client, and the
`AsOfReplayPage`, `DiligencePackPage`, and updated `BoardPackPage` surfaces, each with distinct loading,
ready, empty, and error states and a dash, never a fabricated zero, for a missing figure.

### Verification

Typecheck and build are green across the workspace (exit 0 on both; portal built, api-server bundled). The
full suite is green at 1034 tests (api-server 610 across 69 files, portal 263 across 21 files, cortex 110
across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4), up 29 from
Phase AL's 1005; the new tests are api-server `asOfMath` (9), `contentHash` (7), `asOf.integration` (7,
against live Postgres), and `pack` (6). The long-dash sweep is zero on both sides: the source guard is green
over authored source including the Phase AM Markdown, and a fresh database-wide cast over all 183 public
text and jsonb columns across the 44 base tables (one table added in AM) reports zero hits. Zero new npm
dependencies. The architect `evaluate_task` returned PASS after two remediation rounds; the final round
closed a connected-signal supersession blocker: the as-of efficacy originally recomputed its
connector-grounded drivers from the live `derived_signals`, which a refresh delete-replaces, so a refresh
after the as-of date erased the signals that grounded a past connected build and understated its coverage
and freshness; the fix captures the build-time signal metadata on the snapshot (a `signalMeta` jsonb column
of de-identified `{ sourceConnectorKey, computedAt }` references, never raw content) and the as-of efficacy
recomputes from it, with a regression proving a post-as-of refresh cannot erase a past build's coverage or
freshness. The re-review confirmed the as-of read-model reads only append-only timestamped state and edits
nothing, the efficacy and confidence are recomputed honestly from what the build held, the diff is null
rather than zero when a side is absent, the diligence pack assembles from persisted state and flags a broken
chain rather than asserting integrity, and the hard constraints hold. The accepted LOWs are source-reviewed
and logged in `phase-AM.md`: the diligence pack data assembly and the two read routes have no dedicated
integration test (the as-of read-model is integration-tested, the pack render is unit-tested, and the
services behind the assembly are tested), and the portal as-of and diligence surfaces including the
`replayApi` client (the read-model and the render behind them are tested). The drift report is `phase-AM.md`;
the drift index and the rollup are updated to "A through AM". Phase AM is not a milestone; the build advances
to Phase AN (the final verification and consolidated report that closes Stage 6 and the whole build).

## Phase AN: the final verification and the consolidated report (closes Stage 6 and the whole build)

### What this phase closed

Phase AN is the fourth and last phase of Stage 6, the final stage, run under the same owner authorization
that cleared the AJ milestone pause to execute the AK-AL-AM-AN sequence linearly. It builds NO product
feature and changes no product code. Its deliverables are a fresh full re-verification that every Stage 6
guarantee and every load-bearing invariant of the whole build still holds and is pinned by a test that turns
red when broken, and this consolidated report that records, for an outside reader, the scoring design, the
efficacy index weights, the decision and forecast schemas, and the honest-labelling rules that run through
the entire system.

### Verification

The configured workflows were re-run fresh in the protocol order, with typecheck and build never run
concurrently with the test suite. Typecheck is clean across the workspace (exit 0). Build is clean (exit 0;
the portal builds to 1765 transformed modules, the api-server bundles to `dist/index.mjs`). The full suite is
green at 1034 tests with zero failures (api-server 610 across 69 files, portal 263 across 21 files, cortex
110 across 13 files, connectors 29 across 5 files, edge-agent 10 across 3 files, db 8, scripts 4); the only
stderr lines are warn-level logs emitted by tests that deliberately exercise failure paths (an alert-delivery
failure, a Sentry report that reports failed without throwing, a push digest whose tenant access was revoked
since the event was recorded), each of those tests passing. The long-dash sweep is zero on both sides: the
source guard is green over all authored source including this Phase AN Markdown, and a fresh database-wide
cast over all 183 public text and jsonb columns across the 44 base tables reports zero hits. Zero new npm
dependencies across the whole build. The architect `evaluate_task` returned PASS with no remediation rounds
and no blockers, confirming over the Stage 6 source that each invariant is genuinely pinned by a test that
would turn red if it broke, that there is no blocker to closing the whole build, and that this report's scope
is complete.

### The scoring design

Three measures are kept deliberately distinct so none can launder the others, and the separation is the
honesty boundary. CONFIDENCE says how sure the reasoning is about a claim; it is the cortex Evaluator's
assessment, tempered downward (never upward) by the calibration record. DATA EFFICACY says how good the fuel
behind a layer was; it is a structural property of the inputs (are feeds present, are signals fresh, are
claims verified or only modelled, did findings survive challenge, are sources diverse), independent of how
confident the narrative sounds. CALIBRATION says whether the system's past probabilities matched reality; it
is the Brier-scored track record that resolves over time. A layer can be confident on thin data (high
confidence, low efficacy), or grounded but unproven (high efficacy, early calibration), and the surfaces
state each honestly rather than collapsing them into one flattering number.

The DATA EFFICACY INDEX (Phase AK) is a 0-to-100 weighted average over five named drivers, computed at read
time from persisted state (no stored score that could drift): coverage (feeds present versus the layer's
declared feeds), freshness (the newest derived signal's age against the cadence), verification rate (verified
versus modelled claims), adversarial survival (confounders ruled out versus total), and source diversity
(distinct sources behind the diagnosis). A driver with genuinely nothing to measure is null, contributes
zero, and is DISCLOSED as unmeasured (the index reports the share of weight that is unmeasured) rather than
quietly renormalised away, because hiding missing evidence would flatter the score. Each driver shows its own
contribution in points, and the index names the single cheapest improvement (the driver whose lift per unit
of effort is highest, with an imperative hint). Outside-in and connected modes differ HONESTLY: an
outside-in tenant's connector-grounded drivers (coverage, freshness) are structurally zero, so its mode
ceiling is below 100 and the index says why, which is the honest demo-to-pilot number; a connected tenant can
reach 100.

The BRIER-SCORED CALIBRATION LEDGER (Phase AJ) scores every binary, resolvable forecast with the proper
scoring rule `(p - o)^2` over a clamped probability, against a fixed 0.25 baseline (the score of always
saying 0.5). An empty set is a null mean, never a fabricated zero. A ten-band calibration curve buckets
forecasts by predicted probability with null empty bands, and below a per-segment resolved-count threshold
(`CALIBRATION_MIN_RESOLVED_PER_SEGMENT`, default 10) the surface carries an honest "early, n resolved" label
rather than a premature verdict. The calibration feeds confidence in one direction only: it can pull a
layer's confidence DOWN when the track record is worse than claimed, never inflate it.

### The efficacy index weights

The driver weights live in one documented configuration (`artifacts/api-server/src/lib/efficacy/config.ts`),
env-overridable and renormalised to sum to 1 so the index is always a proper weighted average. The defaults
are coverage 0.25, verification rate 0.25, source diversity 0.20, freshness 0.15, and adversarial survival
0.15. Coverage and verification carry the most because "is the data even present" and "is the claim verified
or only modelled" are the two questions a buyer asks first; freshness and adversarial survival temper that;
source diversity rewards triangulation. Freshness uses a half-life decay against a cadence
(`DEFAULT_FRESHNESS_THRESHOLD_SECONDS`, one day, mirroring the connector catalogue's default staleness
window): a signal one threshold old reads 0.5, two thresholds old reads 0.25, and anything past the maximum
multiple (`DEFAULT_FRESHNESS_MAX_MULTIPLE`, four) reads 0 rather than an ever-smaller positive number. Source
diversity reads a full 1.0 at a target of five distinct sources and scales linearly below it. The feed-to-
family bridge is a documented, no-schema map: a feed counts as covered when a derived signal for the layer
comes from a connector in one of the feed's mapped families, and a feed with no mapped family (for example
open "News") is reported as not measurable from connectors rather than silently guessed as covered or as a
permanent miss.

### The decision and forecast schemas

A DECISION RECORD (Phase AL, `decision_records`) is a recorded HUMAN act and always appends exactly one
hash-chained provenance entry. It persists the decision kind (commit, defer, or reject), the actor and time,
a snapshot of the system recommendation as it stood at decision time (title, detail, impact, predicted value,
confidence, basis) bound by a `recommendationHash` over a stable ASCII canonicalisation so a later refresh
can never silently re-point the audit, whether that snapshot was read and verified server-side or came from
the client (`recommendationVerified`), the evidence refs grounding the layer at decision time (references
into the append-only provenance ledger, never raw evidence; an empty array is the honest state for an
ungraded outside-in layer), the rationale (hashed into the provenance digest, never stored raw), the linked
forecast, and `contradictsRecommendation` (computed once at decision time). A pre-mortem (`pre_mortems`,
`pre_mortem_indicators`) attaches a real Confounder cortex call's ranked failure modes and one watched
early-warning indicator per mode, with an honest completed-or-failed lifecycle.

A FORECAST (Phase AJ, `forecasts`) carries its honesty boundary in its column nullability. `probability`
(numeric(5,4)) is set at creation from the REAL Evaluator output; `outcome`, `resolvedAt`, `brierScore`, and
`resolutionBasis` (an enum of measured, modelled, owner) stay NULL until the forecast actually resolves, so
an unresolved row can never carry a fabricated score. Five kinds are scored (action_outcome,
risk_occurrence, anomaly_materiality, finding_survival, confounder_verdict). An action_outcome forecast links
to its committed action by an explicit id-or-anchor reference (never a title match) and resolves
automatically only on a terminal outcome measurement, or by an owner adjudication computed server-side under
an unresolved-row guard that prevents a double-resolve. The AM as-of snapshot ledger (`tenant_layer_snapshots`)
sits beside these: one append-only row per layer build capturing the build-time content, content hash, data
mode, feeds, and the de-identified connected-signal metadata, so a past state can be reconstructed faithfully
without editing history.

### The honest-labelling rules

The rules that run through the whole system, end to end: a figure is computed from persisted state or it is
not shown (never fabricated telemetry, health, or output); modelled findings are always labelled beside
verified ones and the distinction is never collapsed; a missing figure renders as a dash, never a zero, so a
surface never implies a move from or to zero; loading, empty, and error states are honest and distinct; an
unconfigured external seam (the GCP secret store, the GCS archive store, the cloud or customer KMS, an
unimplemented connector) reports "available, not connected" and fails loudly and lazily on first use rather
than crashing the boot or faking a result; a crypto-shredded tenant read fails with a typed error rather than
returning empty or plaintext, and a raw human signal read requires an active break-glass grant that is
audited; the provenance ledger is append-only and a verify reports a broken chain at its entry rather than
asserting integrity; and the ASCII-hyphen rule holds in source AND in data, enforced by a source guard and a
database-wide row sweep that both read zero before any phase is done. No secret VALUE is ever persisted to a
database column or to `.replit`; only references and one-way hashes are stored.

### Close

The whole Elevated Intelligence V2 build is complete: Stages 1 through 6 (Phases A through AN) are gated and
verified, the full suite is green at 1034 tests, the two-sided long-dash sweep is zero, and zero new npm
dependencies were added across the build. Phase AN is the closing milestone of Stage 6 and of the whole
build; the drift index and the rollup record the build as closed at "A through AN", and there is no next
phase.

## Phase AO: priority connectors (opens the Robustness and Magic wave)

Phase AO opens the Robustness and Magic wave (AO through AS), a post-AN follow-on that reopens the build,
closed at the Phase AN milestone, to harden the platform and sharpen its surface. AO is the connector phase:
it turns six of the catalogue's previously declared-only entries into real, zero-SDK HTTP runtimes against
the uniform connector contract, each running in the in-client edge agent and each reducing a provider's API
to only the declared catalogue signals for its family.

### The six connectors

Each connector imports only `@workspace/db/contracts`, resolves its credential through
`ctx.resolveSecret(scope.authRef)`, builds its signal set with `buildSignalSet`, and returns it through
`assertDerivedSignalSet`, so the derive-and-discard boundary holds by construction:

- salesforce (crm-sales, oauth2): pipeline_coverage_ratio, win_rate_pct, sales_cycle_days, and
  stage_distribution from SOQL aggregate queries (server-side GROUP BY counts and sums) plus one bounded,
  date-only projection for the cycle. No opportunity name, owner, account, or id is read.
- hubspot (crm-sales, oauth2): the same four crm-sales signals from a bounded paged walk of deal PROPERTIES
  (stage, amount, created and close dates, the closed and closed-won flags); no deal id, contact, name, or
  email is touched.
- quickbooks-online (accounting-erp, oauth2): gross_margin_pct, revenue_trend_delta, ar_days_outstanding,
  and expense_ratio from the QBO Reports API (the Profit and Loss summary totals for the current and prior
  windows and the Aged Receivables total). Only the numeric totals in each report summary are read.
- google-analytics-4 (marketing-web-analytics, oauth2): conversion_rate_pct, cac_trend_delta,
  channel_mix_distribution, and engagement_index from the GA4 Data API runReport totals; the channel labels
  order the distribution and are then discarded.
- shopify (commerce-pos-inventory, oauth2): sell_through_rate_pct, inventory_turns, aov_trend_delta, and
  stockout_ratio from the REST Admin order and product feeds with Link-header cursor pagination, reading
  only order totals, line-item quantities, and variant inventory quantities.
- zendesk (support-customer, oauth2): csat_index, first_response_hours, ticket_volume_trend_delta, and
  resolution_rate_pct from the search/count endpoint (server-side aggregate counts) plus a bounded sample
  mean for the first response time.

### The shared HTTP substrate

`lib/connectors/src/httpJson.ts` is the one place a connector touches a provider over HTTP. It uses the Node
global fetch and adds nothing to the dependency tree (no SDK, no client library): a bounded timeout on every
request, a typed `ConnectorThrottleError` on an HTTP 429 carrying any Retry-After hint (the runtime owns the
retry, so the helper never retries internally and never doubles the backoff), `nextLink` to follow an RFC
5988 Link header for cursor pagination, and a strict rule that a response body is never logged or attached to
an error (a provider error body can echo the sensitive request). `httpRequestJson` returns the headers and
status alongside the parsed body so a Link-paginated connector can follow the cursor without a second request
shape; `httpJson` is the body-only common case.

### Registration and the honesty boundary

The six are added to `IMPLEMENTED_CONNECTORS` in the registry and flipped to `implemented: true` in the
catalogue; every other catalogue entry and the two bring-your-own-warehouse connectors (generic-sql,
redshift) are untouched and still report an honest available-not-connected error. OAuth connections continue
to refresh through the existing oauthRefresh and connected-refresh paths. The honesty boundary is carried all
the way through the reduction: a per-connector allowlist guard rejects any draft whose key the connector did
not declare; and a figure is OMITTED (rendered later as a dash, never as a zero or an understated partial
sum) whenever its population is incompletely observed. That covers the ordinary missing-field case (an open
deal with no amount, a receivables line with no total) AND the partial-observability class where a paged walk
is truncated at its record cap: HubSpot omits all four signals when its deal search is truncated mid-walk,
and Shopify folds order-feed truncation into its revenue and units completeness and product-feed truncation
into its on-hand completeness, so a figure computed over an arbitrary partial sample of the window is never
shown. QuickBooks aged-receivables completeness propagates from a wholly malformed nested section so a
nested-only failure cannot silently understate the figure.

### Tests

`lib/connectors/src/connectors/priorityConnectors.test.ts` (34) drives every connector over a node:http
loopback harness that mirrors each provider's response shape: per-connector derivation of the four signals,
the no-raw-field boundary (no id, email, name, label, or realm id escapes), honest omission (no zero, no
partial sum, and no partial-sample figure on a truncated walk), the throttle path (an HTTP 429 surfaced as a
ConnectorThrottleError carrying the Retry-After hint), and the credential resolved by authRef and sent as a
bearer header. A signal-allowlist guard test pair proves a draft with an undeclared key is rejected, and a
registry integration test pair proves all six are marked, registered, and resolved while the warehouse pair
and the rest of the catalogue stay untouched. The connectors suite moves from 29 to 63. Phase AO also
relocates the `ConnectorThrottleError` class out of the api-server rate limiter into the shared connectors
package (re-exported from `rateLimiter.ts` for its existing callers) so the connector that raises a throttle
over `httpJson` and the runtime that catches it by `instanceof` share one class identity;
`artifacts/api-server/src/lib/connectors/throttleIdentity.test.ts` (3) pins that the re-export is the very
class the connectors raise, that a connector-raised throttle is retried with backoff honouring its
Retry-After hint, and that a genuine error is never retried.

### Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 1167 tests (api-server 644, portal 327, cortex 111, connectors 63, edge-agent 10, db
  8, scripts 4). AO adds 37 tests over the post-AN baseline of 1130: the 34 in `priorityConnectors.test.ts`
  (the connectors package moves from 29 to 63) and the 3 in
  `artifacts/api-server/src/lib/connectors/throttleIdentity.test.ts` (the throttle-identity pins that account
  for the api-server delta).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase AO
  Markdown, and a fresh database-wide row-cast over all 46 public tables reports zero hits (AO writes no
  schema and no data, so the database side stays clean and is re-run fresh to claim zero honestly).
- Zero new npm dependencies (the connectors use the Node global fetch through `httpJson.ts`; no SDK).

### Honest marking

What is TEST-PROVEN here: each connector's reduction of a mirrored provider response to its four declared
signals; the derive-and-discard boundary (no reversible field escapes); the honest-omission rules including
the truncation partial-observability class and the QuickBooks nested-malformed propagation; the throttle
surface; the credential-by-authRef bearer; the allowlist guard; and the registry marking and resolution.
What is the accepted boundary (logged drift): the six runtimes are proven against a node:http harness that
faithfully mirrors each provider's response shape, not against the live third-party API, which needs real
OAuth credentials and is exercised only when a real tenant connects, mirroring how the warehouse connectors
were proven against a real Postgres-wire warehouse while the third-party wires cannot be reached from the
build environment.

### Close

Phase AO passed its architect `evaluate_task` review (PASS) after two honesty remediation rounds: the first
closed a QuickBooks aged-receivables path that did not propagate incompleteness from a wholly malformed
nested receivables section, and the second closed a HubSpot and Shopify partial-observability gap where a
population total could be shown over a truncated, partial sample. The drift index, the rollup, and this build
report advance to "A through AO". Phase AO is gated but not a milestone; the wave continues with Phase AP
(the sovereign seat realisation).

## Phase AP: sovereign seat realisation (correctness audit)

Phase AP is the second phase of the Robustness and Magic wave (AO through AS). On inspection it was redefined
as a correctness audit rather than a from-scratch realisation: the in-boundary sovereign seat was already real
and proven from Phase J (the split pipeline and the in-boundary Lens seam) and Phase AF (the sovereign mode),
so re-building it would have been fabricated novelty. The honest deliverable is the audit of the seat as it
stands, the one honesty defect that audit found and fixed across two remediation rounds, and the documentation
the seat lacked (the new sovereign-seat and as-of data-source-regime section of `replit.md`).

The seat as it stands: the split pipeline routes the two Lens stages (perceive, hypothesise) to an in-boundary
sovereign seat in connected data mode, while the external Synthesist and adversarial seats plus the Evaluator
receive only the profile, the in-boundary Lens output, and the math-only derived-signal grounding, never raw
client content. The adapter (`lib/cortex/src/clients/local.ts`) speaks the OpenAI-compatible
`/v1/chat/completions` wire over the Node global fetch with strict JSON mode, a Bearer only when an api key is
set, 429 backoff, and one corrective retry; `resolveLocalSeat` reads the model from `LOCAL_MODEL_BASE_URL`,
`LOCAL_MODEL_MODEL`, and the optional `LOCAL_MODEL_API_KEY` so no model literal enters source, and
`getExtractionRuntime` returns the runtime only when one is configured, an unconfigured connected Lens failing
loud with no silent external fallback.

The defect and its fix: at the as-of replay snapshot sink the build-time data-source regime was recorded as
`dataMode === "outside_in" ? "outside_in" : "connected"`, which collapses a `sovereign` model-execution mode
into a connected DATA source and would lift a past build's as-of efficacy ceiling to 100 over data it never
consumed. The first fix re-read the live `tenants.dataMode` column at snapshot time; the architect rejected it
as a race, because a mid-build flip of the mutable column could stamp a regime the build never ran under. The
race-immune fix threads an explicit `dataSourceMode` decided ONCE at the seed decision point through
`runLayers` and `runLayer`, recording the regime the build actually grounded on and deleting the snapshot read
of the mutable column; a post-build mode flip is preserved as legitimate live/as-of divergence, not a
retroactive restamp. No in-transaction validation was added, deliberately: with the regime threaded there is
no mutable read left to validate, and a later mode flip is intended divergence, not a defect.

### Verification

- Typecheck and build green across the workspace (exit 0 on both).
- The full suite is green with zero failures (api-server 647 tests across 78 files, edge-agent 10, plus the
  portal, cortex, connectors, db, and scripts suites). The three `snapshotDataMode.integration.test.ts` cases
  all pass, the third proving race-immunity (the live tenant row reads connected while the build threaded
  outside_in, and the snapshot records outside_in with an as-of ceiling below 100). The heavily loaded
  api-server integration suite is contention-sensitive (a saturated run intermittently flaked one unrelated
  integration test, observed once as a 5000ms timeout and once as a transient 500 on a different test); a clean
  re-run passed all 647, and the flake touches neither the orchestrator threading nor the snapshot sink this
  phase changed.
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase AP
  Markdown, and a fresh database-wide row-cast over all 46 public tables reports zero hits (Phase AP writes no
  schema and no data).
- Zero new npm dependencies (the audit changed orchestrator threading and documentation only).

### Honest marking

What is TEST-PROVEN: that the as-of snapshot records the threaded data-source regime the build was grounded on
and never the mutable live column, including the race case where they disagree, and that the as-of efficacy
ceiling tracks that regime (below 100 for outside-in, reaching the connected regime for connected). What is the
accepted boundary (logged drift): the in-boundary seat runs against a live local model only when a
`LOCAL_MODEL_*` endpoint is configured (available, not connected by default, proven against a `node:http`
adapter harness rather than a live local model the build environment does not host); and the api-server
integration suite is contention-sensitive, intermittently flaking one unrelated test under a saturated run
while a clean re-run passes all 647 (an environmental flake, not a regression).

### Close

Phase AP passed its architect `evaluate_task` review (PASS) after the threaded fix closed the race the first
fix introduced. The re-review confirmed the race is closed by construction, that omitting an in-transaction
validation is correct (a post-build mode flip is legitimate live/as-of divergence), and that the new
race-immunity case genuinely locks the invariant. The drift index, the rollup, and this build report advance
to "A through AP". Phase AP is gated but not a milestone; the wave continues with Phase AQ (the outcome loop
closure).
