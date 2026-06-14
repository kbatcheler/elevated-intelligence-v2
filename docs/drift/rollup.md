# Drift rollup: Phases A through M

A cross-phase view of every drift item logged so far, grouped by whether it is
still live, one-time and resolved, or a recurring environmental fact. Read the
per-phase reports for the full context; this is the at-a-glance comparison.

Last updated after Phase M (the closing full verification of the connector and SOC 2
stage, Phases H through L, against Part 8 of the addendum, plus the consolidated
build-report append; verification and reporting only, no product code change; gated,
not a milestone).

## Phase verdicts

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | Pass | yes (passed) |
| D | Auth, Orgs and Access | Pass | no |
| E | Product Surfaces | Pass | no |
| F | Fast Seeding and World-Class Seed Data | Pass | no |
| G | Parity Gate and Core Build Report | Pass | yes (paused for owner review) |
| H | Connector Framework and Registry | Pass | yes (paused for owner review) |
| I | Connected Mode, Edge Agent, and Runtime No-Write Guard | Pass | yes (paused for owner review) |
| J | Split Pipeline (Tier 2, the Lens In-Boundary) | Pass | no (gated, paused for owner confirmation) |
| K | Tier 3: Cryptographic Isolation, No Standing Access, Hash-Chained Provenance | Pass | yes (paused for owner review) |
| L | Connected Portal Security Surfaces (Posture, Connections, Break-glass, Provenance) | Pass | no (gated, paused for owner review) |
| M | Stage 2 Full Verification and the Build-Report Append | Pass | no (gated, paused for owner review) |

## Recurring environmental drift (accepted, not fixable in code)

- No manual git tags. Replit manages version control through automatic
  checkpoints, so `docs/drift/INDEX.md` is the progress source of truth in place of
  per-phase `phase-<id>` tags. Logged in A through F.
- Hosted CI cannot execute inside this environment. The GitHub Actions workflow's
  four steps (install, typecheck, build, test) run locally and pass, which is the
  same evidence the hosted job would produce. Introduced in B, referenced since.
- Owner secrets reach the workflow processes only, not the agent shell or sandbox,
  so live owner login is verified via the integration suite and the bootstrapped
  owner row rather than an interactive curl. Logged in D, holds since.

## Still live, worth attention

- In-memory rate limiter for auth (D). Per process, resets on restart, not shared
  across instances. Fine for a single instance; needs a shared store before
  horizontal scaling. Note: the SEED pipeline no longer uses an in-module limiter,
  it uses the Postgres-backed `pipeline_jobs` claim queue (F); this caveat is now
  scoped to the auth rate limiter only. Captured in `docs/deploy-readiness.md`.
- SESSION_SECRET coupling (D). PIN code hashes and session signatures both derive
  from it, so rotating it invalidates all sessions and all outstanding PINs at
  once. Operational caveat, captured in `docs/deploy-readiness.md`.
- Live seed concurrency held at LAYER_CONCURRENCY=2 (F). The Anthropic integration
  rate-limits hard; above about four concurrent claimers a seed hits a 429 storm,
  and an errored layer is terminal, so the live runs were benched at 2 for zero
  429s. The default is 5; recorded timings are conservative against it. Provider
  rate limit, not a code defect.
- Express-to-full total cost exceeds a direct full seed (F). Express optimizes time
  to first ready, not total cost: express plus a later upgrade is more wall-clock
  and spend than one direct full seed. A deliberate trade, not a defect.
- Local KMS is a software key store, not an HSM (K). The default `KmsRuntime` holds
  the per-tenant key-encryption keys in operator-controlled Postgres
  (`kms_local_keys`), so the isolation and crypto-shred guarantees hold in software
  but the keys are not in dedicated key hardware. The customer-managed-key path is a
  swappable adapter that reads "available, not connected" until configured; a real
  cloud KMS or bring-your-own-key service implements the same interface with no
  envelope or call-site change. Captured here and in `phase-K.md`.
- Provenance ledger append-only is enforced in the application, not yet at the DB role
  (K, re-confirmed in M). The module exposes only `appendEntry` and `verifyChain` and links entries by
  content hash, so any edit, reorder, or delete breaks `verifyChain`; revoking UPDATE
  and DELETE on the table at the database-role level is a deployment-time hardening
  left to the operator. Integrity control today is the hash chain plus the serialized
  append.

## Live but runtime-only or cosmetic

- Provider rate limits (C, F). Free-tier Anthropic and Gemini return frequent 429
  under fan-out; absorbed by inner backoff and outer retry, and by the benched seed
  concurrency. Surfaces only during a seed; no failure is masked as success.
- Schema tolerance over rejection at model-output boundaries (C, F). Grounded model
  output is coerced and sliced rather than rejected; semantic enums are never
  coerced at the storage boundary. Known cosmetic limit: a thousand-separated
  sparkline value such as 1,200 reads as 1. Extended in F: the score-stage claim
  `basis` coerces an unknown or missing value to the conservative `modelled` at the
  stage input boundary, while the stored content schema stays strict.

## One-time or resolved

- Portal had zero automated tests (B). Deferred from B with `--passWithNoTests`.
  Closed after Phase D: the portal data layer is unit tested across both surfaces
  (auth and the Access console), with a mocked fetch covering every status-to-error
  and 401 branch. Only DOM-rendering component tests remain deferred, because jsdom
  and a testing-library would be new dependencies held off under the
  zero-new-dependency rule.
- Cross-tenant breadth deferred from Phase E to Phase F (E). Phase E built the
  portal against the one seeded tenant and deferred multi-tenant breadth to F.
  Resolved in F: four real tenants are seeded to ready with verifiably distinct
  figures.
- Score-stage basis fragility (F). The Evaluator occasionally emitted a claim basis
  outside {verified, modelled}; the in-call retry self-corrected it every time
  (zero seed failures). Resolved in the F remediation: the score-stage basis
  coerces unknown or missing values to `modelled` at the input boundary and the
  prompt states the allowed values, while stored content stays strict.
- Anchor-sweep "any shared figure fails" premise (F). The first sweep failed on any
  shared currency figure, which is empirically wrong for independent real
  companies. Resolved in F: the sweep fails on a real templating signature (a pair
  sharing two-plus specific figures or over 30 percent of its anchors, or a
  specific figure broadcast to three-plus tenants), and the pass/fail logic is
  extracted into a unit-tested pure module.
- Long dashes in persisted generated data, especially the run table (G). A source-
  only em-dash guard cannot see model-generated text that lands in the database. The
  Phase G gate sweep found long dashes in 39 `tenant_pipeline_runs` rows (the raw
  per-stage outputs persisted by the orchestrator) while every other table was
  clean. Resolved in G: the deterministic sanitizer now runs at every jsonb persist
  boundary (the tenant profile, the `tenant_layers` row, and the run sub-stage and
  error writes), the cleanup script and the database-wide sweep cover the run table
  and `pipeline_jobs`, the 39 rows were cleaned to zero, and the source guard was
  strengthened to catch the en-dash as well as the em-dash.
- Empty V2 import and V1 reference URL from the owner (A). The V2 target repo
  imported empty and the V1 reference URL was supplied by the owner in chat.
  Recorded in memory for re-clone; resolved.
- Model API keys deferred (A). Deferred to the Phase C boundary and wired there;
  exercised live by the Phase C seed and the four Phase F live seeds. Resolved.

## Logged spec deviations (decisions)

- scrypt instead of bcrypt or argon2 (D). The spec authorised bcrypt or argon2, but
  both ship native addons that are fragile under the Nix toolchain. scrypt is a
  strong, memory-hard KDF in the standard library, so it keeps the
  zero-new-dependency rule. The stored hash is self-describing, so the cost can be
  raised later without breaking existing rows.
- Zod v4 via the `zod/v4` subpath of zod 3.25.x (B). The chosen contract layer.
- `GET /api/tenants` list, access-fenced (E). A deliberate reversal of Phase D's
  no-list stance, scoped by the access fence, so the portal can offer a tenant
  picker without exposing tenants across the fence.
- Postgres-backed `pipeline_jobs` queue brought forward from Phase AH (F). A new,
  separate, generic table so AH and the connector work can extend it later without
  reshaping seed state.
- Patagonia and Hillman are the same scale (F). They genuinely share a $1.47
  billion reported-revenue figure; the anchor sweep surfaces it as a documented
  real-world coincidence (a single-pair warning, below the broadcast threshold),
  not templating.
- Anchor-sweep templating-signature definition (F). What counts as a failure is a
  pair sharing two-plus specific figures or over 30 percent of its currency
  anchors, or a specific figure broadcast to three-plus tenants; round figures and
  percentages stay benign.
- Long-dash sanitization at the persist boundary (G). The prompts ask the models to
  avoid the long dash, but the guarantee is a deterministic pass (`deepStripDashes`)
  on every jsonb sink the orchestrator writes: em-dash to spaced ASCII hyphen,
  en-dash to plain ASCII hyphen, numbers and identifiers untouched. Deliberate
  typography canonicalization, not semantic change.
- Parity verified at the code and component level (G). The Core Master Prompt's words
  are to run V1 and the new system side by side; the verification done is a
  component-by-component inventory against the frozen `reference/v1` source plus the
  full automated suite and the Phase E side-by-side acceptance, not a live two-
  instance dual-deploy. Stated honestly in `docs/build-report-core.md`.
- Three V1 extras not carried (G). The company picker and library mode, the coachmark
  tour, and the signal ticker are outside the named reference-surface set and the
  Phase B through F acceptance items, so they are a scope decision, available later.
- New internal workspace package `lib/connectors` (H). The connector framework is a
  workspace package rather than a folder in api-server, mirroring lib/cortex and
  lib/db, so the contract is importable by the api-server and a future in-client
  agent without dragging in the server. Zero new npm deps; pg and @types/pg were
  already in the lockfile.
- Connector path imports `@workspace/db/contracts` only, never the db root (H).
  Importing the db root opens the application Postgres pool as a side effect; the
  contracts subpath keeps the connector path free of any handle to our store so it
  can run inside the in-client edge agent. Enforced by a static import-boundary test.
- Two warehouse reference connectors implemented, 44 declared (H). The spec's full
  "at least two per family run end to end" is the end-state acceptance for the later
  connector phases; the Phase H order asks for the two bring-your-own-warehouse
  reference connectors, done, with the rest declared and rendered as available, not
  connected. Postgres stands in for the client warehouse in the end-to-end test
  (Redshift speaks the Postgres wire and generic-sql targets any Postgres-wire
  warehouse); Snowflake, BigQuery, and Databricks stay declared because their
  drivers would be new dependencies. The connectors table stores the catalogue
  surface only; the registry-only `path` and `implemented` fields are not columns.
- New `edge_agents` table beyond the Part 4 Tier 1 minimum schema (I). The
  per-tenant agent credential lives in its own table (a scrypt hash of the secret
  plus an active or revoked status) rather than on `tenants` or in `tenant_keys`, so
  a revoke is a single-row update and the credential never mixes with key material.
  An addition, not a rename.
- Agent bearer is the API trust root, mTLS terminates at a proxy (I). The server
  reloads the credential row on every agent call for immediate revoke and never
  trusts a proxy-injected client-certificate header; mutual TLS protects the channel
  at the proxy while the bearer authorizes the request at the application. Proven
  over a loopback client-certificate handshake (a no-certificate client is rejected).
- Edge-agent base URL enforced HTTPS by default (I). Plain http is allowed only for
  a loopback host or an explicit `EI_AGENT_INSECURE_HTTP=1` test opt-out, so the
  bearer is never sent in clear by misconfiguration. Applied as the architect's
  non-blocking security note and covered by a config test.
- Connected grounding appended only on the connected path (I). Both data modes run
  one shared `runLayers` helper and outside-in passes no grounding, so the
  outside-in prompts are byte-for-byte unchanged while connected mode grounds on
  `derived_signals` only.
- Runtime no-write guard is a tripwire, not a sandbox (I). ESM `node:fs` bindings are
  read-only and cannot be patched, so the runtime guard catches require-based ambient
  writes only; the primary guarantee is the static import-boundary test that forbids
  `node:fs` (and the db root) in connector and edge-agent source. The process-global
  patch window could in principle trip a concurrent legitimate CommonJS filesystem
  write during a long extraction, but no such live write path exists, so it is
  recorded, not active. Edge connectors are declared not implemented; the runner is
  proven with an injected stub over real mutual TLS, not faked telemetry.
- The Lens is the in-boundary set; the Synthesist and adversarial seats stay external
  (J). In connected mode only perceive and hypothesise run in-boundary on the local
  seat, because the Lens is where the client's own signals are first interpreted; the
  later external seats operate on the already-derived Lens output and the math-only
  grounding, never raw client content, so they can stay on the stronger external
  models. The split is a no-op in outside_in mode.
- Fail loud, never a silent external fallback (J, the architect's Option C). A
  connected run with no local seat configured returns "available, not connected"
  rather than quietly sending the sensitive stages to an external provider. Honesty
  over availability; the operator must configure the boundary model deliberately.
- The local model identifier is read from env, not a source literal (J). Keeps the
  existing no-literal-model-string invariant intact and `SEATS` at the three external
  seats, while letting the operator pick any self-hosted model at deploy time via
  `LOCAL_MODEL_BASE_URL`, `LOCAL_MODEL_MODEL`, and an optional `LOCAL_MODEL_API_KEY`.
- One narrow seam (`ExtractionZoneRuntime`) for every in-boundary call, the TEE not
  built (J). The cortex never knows whether the call is a plain HTTP adapter or a
  future attested TEE runner, which is what lets the TEE drop in later with no stage
  or orchestrator change. The in-boundary guarantee this phase is deployment-
  topological (the model runs on operator-controlled infrastructure), not yet
  cryptographically attested; the local endpoint is a trusted deployment target, and
  the adapter never logs an upstream error body and never exposes the api key through
  the seam.

- Envelope stored inside `derived_signals.value` jsonb, no new column (K). Each signal
  value becomes `{v,alg,keyRef,iv,tag,ct,wrappedDek}` in the existing jsonb rather than
  adding ciphertext columns, so the connected persist and read paths change but the
  table shape does not; the derived-set root hash is still computed over the plaintext
  math, not the ciphertext.
- One per-tenant KEK, no global HKDF (K). The local KMS holds a distinct random 32-byte
  key-encryption key per tenant rather than deriving per-tenant keys from one master,
  because crypto-shred must destroy exactly one tenant's ability to decrypt and nothing
  else; a shared master with per-tenant derivation could not be shredded per tenant.
- No standing access, break-glass for every role including owners (K). Reading raw
  signal values requires tenant access plus an active, unexpired, unrevoked grant even
  for an owner, and every access appends an `access_grant_events` row; the in-boundary
  machine-grounding read is a separate service API that is exempt by design, never a
  middleware bypass of the human guard.
- Reads fail loud, never silent empty grounding (K). A revoked or missing key, a
  legacy-plaintext row, or an absent or expired grant raises a typed error
  (`crypto_shredded`, `break_glass_required`, and the encryption error types) rather
  than returning an empty result that would read as "no data"; the orchestrator records
  a loud layer failure instead of grounding on nothing.
- Phase M is verification and reporting only (M). The connector and SOC 2 stage (H
  through L) was verified against Part 8 with no product code change; item 2 is recorded
  as partial (the catalogue is complete at 46 connectors across ten families, but only
  the warehouse family runs two connectors end to end) and item 9 as met-with-residual
  (application-layer append-only plus the hash chain plus the UI verify, with
  database-role write blocking deferred to deployment), and the connected-refresh time
  was measured on the real warehouse path, not a stub or an invented number.

## No faked output, any phase

Phase M added no faked output and no faked telemetry: it built nothing and changed no
product code. It verified the stage and recorded an honest result, marking item 2
partial (the catalogue is complete and honest at 46 connectors across ten families, but
only the warehouse family runs two connectors end to end) and item 9 met-with-residual
(application-layer append-only plus the hash chain plus the UI verify, with
database-role write blocking still a deployment-time hardening), and the
connected-refresh latency was measured on the real warehouse path (median 60.9 ms on
local Postgres-wire), not a stub or an invented number. Phase L below holds, and the
earlier phases under it.

Phase L added no faked output and no faked telemetry. The portal security surfaces
render only real backend facts: the customer-managed KMS is shown as "available, not
connected" exactly as the backend reports it, every fetch error is a distinct state
from an empty result, the three Tier 3 refusals (break-glass required, crypto-
shredded, unreadable) each map to their own honest notice rather than an empty list,
and the human signal read shows decrypted values exactly as the math produced them,
never cached or exported and never invented when absent. The e2e ran against a real
signed-in provider-owner over real HTTP, not a mocked shell. Phase K below holds, and
the earlier phases under it.

Phase K added no faked output and no faked telemetry. The local KMS performs real
AES-256-GCM wrap and unwrap and a real key destroy (crypto-shred is proven by a read
that returns a typed `crypto_shredded` error after revoke, not a stubbed value); the
customer-managed-key adapter reports an honest "available, not connected" until a key
is configured rather than fabricating a wrap or a status; the break-glass and
provenance surfaces are exercised end to end over real HTTP against a real Postgres,
and verifyChain is tested on both a clean and a deliberately corrupted chain. Phase J
below holds, and the earlier phases under it.

Phase J added no faked output and no faked telemetry. The in-boundary adapter is a
real HTTP client, proven against a real `node:http` server; when no local model is
configured `getExtractionRuntime` returns null and the connected Lens fails loud with
"available, not connected" (telemetry model "local: not connected") rather than
fabricating an answer or silently falling back to an external provider. The split-
routing tests use an injected runtime to assert routing, not to stand in for real
output that was required this phase, and the external seats still receive only the
profile, the Lens output, and the math-only derived-signal grounding. outside_in is
byte-for-byte unchanged. Phase I below holds, and the earlier phases under it.

Phase I added no faked telemetry: no edge connector is implemented, every edge
connector returns the honest "available, not connected" error, and the edge-agent
runner is proven with an injected stub connector over a real mutual-TLS loopback
rather than fabricated signals. Connected-mode grounding renders only the numeric
`derived_signals` (a vector as `vector[len]`), never raw client text, and a raw
`DerivedSignalSet` violation fails the run loudly in both the refresh service and the
agent ingest path. Phase H below holds, and the earlier phases under it.

Phase H added no generation and no faked output: the two warehouse reference
connectors run real aggregate SQL against a real warehouse and return computed
math, the other 44 connectors are honestly declared and return an "available, not
connected" error rather than stub data, and the catalogue's declared signal keys
are statements of capability, not measurements. The earlier phases hold as below.

Across A through G nothing is stubbed, mocked, or faked: the cortex and Confounder
run live (C) and were exercised again by four end-to-end Phase F live seeds (three
fresh tenants plus a live express-to-full upgrade), each recording real per-seat
tokens, latency, and cache figures; express mode marks reduced layers honestly
(skipped sub-stages with no model call, not invented content); the portal renders
real registry, session, and persisted layer data with explicit loading, empty, and
error states (E); and the auth suite drives the real app against live Postgres (D).
The Phase G parity gate added no generation; it inventoried the real surfaces,
completed the long-dash enforcement over persisted data, and stated the parity
method honestly rather than claiming a live dual-deploy that did not happen.
