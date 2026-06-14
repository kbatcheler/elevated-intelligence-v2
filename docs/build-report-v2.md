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
