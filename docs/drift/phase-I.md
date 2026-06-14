# Phase I: Connected Mode, the In-Client Edge Agent, and the Runtime No-Write Guard

Phase id: I. Name: Connected Mode, Edge Agent, and Runtime No-Write Guard.
Milestone: yes (hard stop for owner review before Tier 2).

The second phase of the V2 data-connector addendum, and Tier 1 of the connected
pipeline in full. It wires connected-mode grounding into the cortex, builds the
connected refresh service and the shared derive-and-discard persistence path, adds
the per-tenant agent credential and routes, ships a separate in-client edge-agent
package proven over mutual TLS, and lands the runtime no-write guard with the
expanded import-boundary tests. This phase added zero npm dependencies and contains
no em-dash or en-dash.

## Build summary

- **Connected grounding context** (`lib/cortex/src/prompts/shared.ts`, threaded
  through the layer runners). A bounded `LayerGrounding` built from `derived_signals`
  grouped by layer (source connector key, signal key, numeric value, window,
  computed-at), threaded as an optional parameter into `runLayer` and all seven
  prompt builders and appended only on the connected path. The renderer prints
  derived math only; a vector signal renders as `vector[len]`, never dumped.
- **Connected refresh service and the shared persistence path**
  (`artifacts/api-server/src/lib/connectors/`). `connectedRefresh.ts` loads the
  tenant's connected connections, skips edge connectors, reports a
  boundary-but-unimplemented connector as "available, not connected", opens a
  `connector_runs` row, runs the guarded extraction in process, and persists only in
  the caller. `persistSignals.ts` resolves the connection's layers from the
  descriptor, computes a root hash over source plus tenant plus signal tuples,
  asserts the set, checks the tenant and source match, fans each signal across the
  connector's layers, and does a delete-prior then insert in one transaction so a
  refresh supersedes the prior derived signals.
- **dataMode branch and the connected refresh route** (the `lib/cortex`
  orchestrator). `seedTenant` branches on `tenant.dataMode` after a single lookup.
  Connected mode is refresh-only for an existing tenant: load the `ProfileOutput`
  from `tenant_profile` (fail loudly if absent or invalid), refresh connectors, build
  a per-layer `LayerGrounding` from `derived_signals`, and run the same shared
  `runLayers` helper with no homepage or profile stage. Outside-in passes no
  grounding through that same helper, so its prompts stay identical. The existing
  refresh route is connected-aware with no new route.
- **Agent routes and per-tenant credential auth**
  (`artifacts/api-server/src/routes/agent.ts` and middleware). A new `edge_agents`
  table holds a per-tenant agent credential (a scrypt hash of the secret only, with
  an active or revoked status). The agent router is mounted at `/api/agent` before
  the session gate: register, config pull (connected edge connectors only, each an
  auth-ref pointer not a secret), and signal ingest (assert derive-and-discard,
  check the tenant match, require a connected edge connector, persist through the
  shared path). `requireAgent` verifies the bearer credential and reloads the row on
  every call so a revoke is immediate, and never reads a proxy mTLS or
  client-certificate header. Provider-only provisioning (issue, list, revoke; token
  shown once) lives on the tenants routes.
- **In-client edge agent** (`artifacts/edge-agent`, a new workspace package). It
  imports `@workspace/connectors` only, plus Node built-ins, and added zero npm
  packages. It registers, pulls its config, runs only `deployment: "edge"`
  connectors, and posts a `DerivedSignalSet`. The transport runs over `node:http`
  and `node:https` with the bearer on every call and a client certificate for mutual
  TLS; the base URL must be HTTPS unless it is a loopback host or an explicit test
  opt-out. Secrets resolve from the agent's own local environment with an HMAC
  tokenizer whose salt stays on the client. A Dockerfile runs the agent as a
  non-root user with a documented read-only filesystem and a one-command build.
- **Runtime no-write guard and expanded boundary tests**
  (`lib/connectors/src/guardedExtractSignals.ts`). Every extraction, in both the
  boundary refresh and the edge agent, runs inside a guard that installs a
  filesystem-write tripwire for the call and asserts the result through
  `assertDerivedSignalSet` before the caller persists. The static import-boundary
  tests are extended: a connector implementation may not import a filesystem or
  subprocess capability, and the edge-agent graph may import only
  `@workspace/connectors`, Node built-ins, and relative paths, never the db root.

## Requirements checklist

- Connected-mode grounding is built only from derived math, never raw text, and is
  appended only on the connected path. Done: the grounding renderer prints numeric
  signals only (a vector renders as `vector[len]`), and the regression test proves
  the outside-in prompts are byte-for-byte unchanged.
- The connected refresh service runs boundary connectors, rejects declared-only
  connectors honestly, and persists only in the caller. Done: extraction is guarded,
  the result is asserted, and `connector_runs` and `derived_signals` are written by
  the caller, never by a connector.
- A raw `DerivedSignalSet` violation fails the run loudly. Done, proven by test in
  both the refresh service and the agent ingest path.
- Agent config pull and signal ingest are tenant-scoped and credential-gated, and
  the server never trusts a proxy-injected client-certificate header. Done: the
  bearer credential is the trust root, reloaded per request for immediate revoke.
- A separate in-client agent imports `@workspace/connectors` only, runs edge
  connectors, posts math only, and proves mutual TLS. Done: the loopback test drives
  the exact agent transport through a real client-certificate handshake, asserts the
  posted body is derive-and-discard math, and proves a no-certificate client is
  rejected at the handshake.
- The extraction path has no filesystem write capability. Done: a runtime tripwire
  plus a static import-boundary test that forbids the connector and edge-agent
  source from importing `node:fs` at all.
- Outside-in regression intact; typecheck, build, and the full suite green; long-dash
  sweep zero across source and data; zero new npm deps. Done (see below).

## Drift items

Category sweep first, then specifics. Every item is acceptable drift.

- Faked, stubbed, scripted, or hardcoded output where real output was required: none.
  No edge connector is implemented, and every edge connector returns the honest
  "available, not connected" error rather than stub telemetry. The edge-agent runner
  is proven with an injected stub connector over a real mutual-TLS loopback, which
  exercises the real transport, handshake, and ingest path; the stub stands in for a
  not-yet-built edge connector, not for real output that was required this phase.
- Renamed tables, substituted libraries, or restructured layout to route around a
  problem: none. The schema uses the Part 4 names; the one new table (`edge_agents`)
  is an addition, documented below, not a rename. No library was added or swapped.
- Weakened checks to pass the gate: none. The runtime no-write guard is documented as
  a tripwire, not a sandbox, and the real guarantee (the static import boundary) was
  strengthened, not relaxed. No assertion was loosened.
- Scope added beyond the phase ask: the `edge_agents` table and the HTTPS base-URL
  enforcement, both documented below. Tier 2 (the split extraction and synthesis
  pipeline and the `localModelAdapter` seat), Tier 3, and the portal connected-mode
  screens are deliberately not built here.
- Silent assumptions or defaults: none silent. The decisions are stated below.

Specific items:

- [acceptable] A new `edge_agents` table beyond the Part 4 Tier 1 minimum schema. The
  per-tenant agent credential needed a home. Rather than overload `tenant_keys`
  (which holds key material) or `tenant_connections` (which holds connection
  configuration), the agent credential lives in its own table with a scrypt hash of
  the secret and an active or revoked status, so a revoke is a single-row update and
  the credential never mixes with key material. No information is lost and no existing
  table is reshaped.
- [acceptable] No edge connector implemented; the runner is proven with an injected
  stub over real mutual TLS. The Phase I order builds the connected pipeline and the
  agent transport, which are proven end to end against a real client-certificate
  handshake; the edge connector implementations are later connector-phase work, and
  until then every edge connector renders as available, not connected. This is the
  phased plan, not a shortfall.
- [acceptable] The runtime filesystem-write guard is a tripwire, not a sandbox. ESM
  named and namespace imports of `node:fs` are read-only bindings that cannot be
  monkey-patched, and a patch of the CommonJS `require("node:fs")` object is not
  observed by ESM imports. So the runtime guard catches require-based ambient writes
  only; the primary guarantee that the extraction path cannot touch the filesystem is
  the static import-boundary test, which forbids the connector and edge-agent source
  from importing `node:fs` at all (and so also catches a dynamic `import("node:fs")`
  by string). The guard is honestly documented as defense in depth. Because the patch
  window is process-global it could in principle trip a concurrent legitimate
  CommonJS filesystem write during a long extraction; no such live application write
  path exists, so this is recorded, not active.
- [acceptable] Mutual TLS terminates at a proxy in production; the bearer is the trust
  root. The agent proves mutual TLS over a loopback server that requires a client
  certificate, but in production an mTLS-terminating proxy sits in front of Express.
  The server's trust root is the per-tenant bearer credential and it never trusts a
  proxy-injected client-certificate header, which is the coherent boundary: the
  channel is protected by mutual TLS at the proxy and the request is authorized by the
  bearer at the application.

## Decisions taken

- `edge_agents` as a dedicated table rather than a column on `tenants` or an overload
  of `tenant_keys`. It keeps the agent credential (a scrypt hash plus a revoke
  status) separate from key material and from connection configuration, so a revoke
  is immediate and auditable.
- The per-tenant bearer credential is the API trust root. The server reloads the
  credential row on every agent call so a revoke takes effect at once, and it never
  reads a proxy mTLS or client-certificate header. Mutual TLS protects the channel at
  the proxy; the bearer authorizes the request at the application.
- The edge-agent base URL is enforced HTTPS by default. Plain http is allowed only
  for a loopback host or an explicit `EI_AGENT_INSECURE_HTTP=1` test opt-out, so the
  bearer credential is never sent in clear by misconfiguration. Applied as the
  architect's non-blocking security note and covered by a config test.
- Connected grounding is appended only on the connected path. Both data modes run
  through one shared `runLayers` helper, and outside-in passes no grounding, so its
  prompts are byte-for-byte identical to the prior build. This is what keeps the
  outside-in regression intact while connected mode grounds on derived signals only.
- `guardedExtractSignals` wraps every extraction in both callers (the boundary
  refresh and the edge agent) as a layered defense, with the static import boundary
  as the primary control.

## Test and verification summary

- Typecheck: clean across the workspace (`pnpm run typecheck`).
- Build: green (`pnpm run build`; portal builds, api-server bundles).
- Tests: the full suite is green. Totals: connectors 27, cortex 55, db 8, scripts 4,
  api-server 96, edge-agent 10, portal 108. New this phase include the connected
  grounding regression (outside-in byte-for-byte), the connected refresh integration
  (fan-out, supersede, raw-violation fails loudly, edge skip and declared-only
  rejected), the agent route integration (tenant-scoped, credential-gated), the
  edge-agent mutual-TLS loopback and import-boundary tests, the base-URL transport
  enforcement test, and the no-write guard tests (good, fs-write blocked writing
  nothing, raw-content rejected, restore, reentrant).
- Outside-in regression: byte-for-byte unchanged, proven by the grounding regression
  test.
- Long-dash sweep, source: the guard reports zero.
- Long-dash sweep, data: zero over all 22 public tables (a per-row text cast checked
  for U+2014 and U+2013).
- Zero new npm dependencies: the edge-agent package reuses the workspace packages and
  Node built-ins; install added only the workspace importer.

## Remediation iterations

- Iteration 1 (architect evaluate_task review, Pass). The architect returned PASS for
  the Phase I milestone with no blocking issues. It confirmed the layered no-write
  guard is sound and honestly documented (a tripwire, not security theater, with the
  static import boundary as the primary control), the import boundaries are correct
  first-party gates, derive-and-discard holds (callers persist, connectors and the
  agent do not; the assert enforces numeric-only signals and the tenant and source
  match), and the agent trust model is coherent (a high-entropy bearer, scrypt hash
  only, per-request reload for immediate revoke, no trust in proxy certificate
  headers). One concrete non-blocking security note was applied immediately: the
  edge-agent now rejects a non-HTTPS base URL by default, allowing plain http only for
  a loopback host or an explicit `EI_AGENT_INSECURE_HTTP=1` test opt-out, so the
  bearer is never sent in clear; a config test covers it. The two larger non-blocking
  notes are recorded as future hardening: replacing the string-scan import boundary
  with AST or module-graph enforcement (and an explicit ban on eval, Function, and
  child_process in connector and edge-agent code), and process or container isolation
  with a read-only filesystem before running untrusted edge connectors. The latter is
  already partly addressed by the Dockerfile's documented non-root, read-only-filesystem
  run.

## Verdict

Pass with noted acceptable drift. Connected-mode grounding, the connected refresh and
shared persistence path, the dataMode branch, the agent credential and routes, the
in-client edge agent proven over mutual TLS, and the runtime no-write guard are built
and proven. The derive-and-discard guarantees hold (no app-DB handle on the extraction
path, persistence only in the caller, math-only return, loud rejection of raw content),
the outside-in regression is byte-for-byte unchanged, and the architect passed with no
blocking drift. The one applied security hardening (HTTPS by default for the agent base
URL) and the documented acceptable drift items (the `edge_agents` table, the tripwire
nature of the runtime guard, mutual TLS terminating at a proxy, edge connectors
declared not implemented) are recorded above.

## Milestone marker

Phase I is a milestone hard-stop. Execution pauses here for owner review before Tier 2
(the split extraction and synthesis pipeline), Tier 3, and the portal connected-mode
screens. Do not auto-advance.
