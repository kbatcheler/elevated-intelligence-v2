# Phase Q: secrets vault

Phase id: Q. Name: Secrets vault. Milestone: no, but gated (a per-phase hard stop for owner
review, here deferred because the owner authorized an autonomous run of O, P, and Q back to
back). This is the last phase of the autonomous run, so execution stops for owner review
after it.

The system already referenced its secrets by name through a `SecretStore` seam introduced
earlier; what Phase Q owed was a real managed backend behind that seam, the lazy
"available, not connected" honesty the KMS and the Phase P sinks already have, and proof
that no resolved secret value is ever persisted to a table or to `.replit`. The single hard
rule is unchanged: nothing is fabricated, and there is no managed secret manager connected,
so the GCP adapter is an honest, tested REST adapter that reports "available, not connected"
until its project is configured, exactly mirroring the KMS pattern. This phase added zero
npm dependencies and contains no em-dash or en-dash.

## What Phase Q built

- The GCP Secret Manager adapter
  (`artifacts/api-server/src/lib/secrets/gcpSecretStore.ts`): a full `SecretStore`
  implementation over the Secret Manager REST API with the Node global fetch and zero SDK.
  Construction reads no config and validates nothing, so an unset project never crashes the
  boot; the first `get`/`set`/`delete` resolves the project and an access token lazily and
  throws a precise "available, not connected: set GCP_PROJECT_ID to connect it" error if the
  project is missing. `get` reads `versions/latest:access` and treats a 404 as `null`,
  base64-decoding the payload; `set` creates the secret container (tolerating a 409 already
  exists) then adds a base64 version; `delete` issues a DELETE and tolerates a 404 so it is
  idempotent. The access token comes from the GCP metadata server (cached until shortly
  before it expires so a token call is not made on every resolution) or, when
  `GCP_SECRET_MANAGER_TOKEN_SOURCE=env`, from `GCP_SECRET_MANAGER_ACCESS_TOKEN`. Every ref
  is validated against the Secret Manager id grammar (`^[A-Za-z0-9_-]{1,255}$`) before any
  network call, so a ref can never smuggle a path traversal or a full resource name. Every
  request is bounded by an `AbortController` timeout (`GCP_SECRET_MANAGER_TIMEOUT_MS`,
  default 5000). Secret values and access tokens are never logged, and an error never
  carries a response body, because the access response body is the secret itself.
- The provider selection (`artifacts/api-server/src/lib/secrets/secretStore.ts`):
  `getSecretStore` constructs the store the environment selects via `SECRET_STORE_PROVIDER`.
  The default is the local env-backed store; `SECRET_STORE_PROVIDER=gcp` selects the GCP
  REST adapter. The adapter is constructed without validating anything, so an unset project
  never crashes the boot and only surfaces on first use. The pre-existing `EnvSecretStore`,
  `requireSecret` (lazy throw-if-missing), and the `setSecretStore` test seam are unchanged.
- Resolution through the store. Every secret the application reads at runtime is resolved by
  name through the `SecretStore`, never from `process.env` at the call site:
  - `SESSION_SECRET` is read through `requireSecret("SESSION_SECRET")` by the auth
    middleware, the auth and admin routes, the PIN pepper derivation, and the connected
    refresh token salt. Swapping `SECRET_STORE_PROVIDER` to `gcp` moves all of them onto the
    managed manager with no call-site change.
  - `OWNER_PASSWORD` is read through `store.get("OWNER_PASSWORD")` by the owner bootstrap,
    which then persists only the scrypt hash; the plaintext password is never written to a
    table.
  - Connector credentials are resolved by `buildConnectorContext.resolveSecret(ref)`, which
    calls `secretStore.get(ref)`; the warehouse connector authenticates by resolving its
    `scope.authRef` through that context. `tenant_connections` stores only the `authRef`
    reference, never a credential value.

## The honest adapter: why nothing is faked

The GCP Secret Manager adapter has no real project connected yet, and the honest way to
ship it is as a tested adapter that reports "available, not connected", not a fake. With
`SECRET_STORE_PROVIDER` unset or `env`, the local env-backed store is used and resolves
secrets from the platform-injected environment, which is the legitimate durable secret home
(the platform owns durable storage). With `SECRET_STORE_PROVIDER=gcp` but no
`GCP_PROJECT_ID`, the adapter constructs cleanly and the first resolution throws the precise
"available, not connected" error rather than returning an empty value or crashing the boot.
When a project and a token are configured, the adapter performs real REST calls against the
real Secret Manager; the unit tests prove the ref-grammar rejection before any network call,
the access/create/addVersion/delete request shapes, the 404-to-null and 409-tolerant
behaviours, the metadata-versus-env token sourcing with caching, the bounded timeout, and
that no value, token, or response body is ever logged or attached to an error.

## Acceptance checklist

1. No secret value is persisted in any table or in `.replit`. Met, and proven by the
   strong form rather than a row-local check. `secretResolution.integration.test.ts`
   resolves a unique random sentinel through an injected `SecretStore` during a real
   connected refresh, then queries `information_schema.columns` for every public-schema
   column whose type is text, character varying, character, json, jsonb, or a text array,
   builds a `UNION ALL` of `count(*)` probes that cast each column to text and match the
   sentinel, and asserts the summed total is zero (with a non-empty column list so an empty
   catalogue cannot vacuously pass). It then locates the repo-root `.replit`, asserts it was
   found, and asserts the file does not contain the sentinel. Because the sentinel is unique
   per run, the sweep correctly ignores the expected design artifacts (the `authRef` and
   `kmsKeyRef` references, password scrypt hashes, wrapped DEKs, and local KMS material),
   which are not that value.
2. A connection authenticates by resolving `authRef` through the store. Met. The same test
   injects a store that returns a credential for the connection's `authRef`, runs the
   connected refresh, and asserts the warehouse connector resolved its credential through
   `ctx.resolveSecret(scope.authRef)` and produced derived signals, while the resolved
   credential value never lands in `connector_runs`, `derived_signals`, or anywhere else in
   the DB-wide sweep.

## New env (no new table, no new column)

- `SECRET_STORE_PROVIDER` selects the backend: unset or `env` uses the local env-backed
  store (the default), `gcp` selects the GCP Secret Manager REST adapter.
- GCP adapter env (all optional, all lazy): `GCP_PROJECT_ID` (required to connect; its
  absence is the "available, not connected" error), `GCP_SECRET_MANAGER_TOKEN_SOURCE`
  (`metadata` default or `env`), `GCP_SECRET_MANAGER_ACCESS_TOKEN` (required only when the
  token source is `env`), `GCP_SECRET_MANAGER_ENDPOINT` (override, defaults to the public
  endpoint), and `GCP_SECRET_MANAGER_TIMEOUT_MS` (default 5000).
- No schema change: secrets are referenced by name; `tenant_connections.authRef` and
  `tenant_keys.kmsKeyRef` are the existing reference columns, and no value column was added.

## Logged drift and deviations

- `tenant_keys.kmsKeyRef` is deliberately NOT routed through the `SecretStore`. The plan
  named tenant key refs as a resolution target, but the KEK material has a different blast
  radius from an API credential: it is the root of the per-tenant crypto-shred guarantee and
  lives behind the KMS runtime (`lib/security/kms.ts`) with its own swappable cloud/customer
  adapter that already reports "available, not connected". Folding it into the general secret
  store would widen its reachability for no security gain. The KMS keeps its own boundary;
  the architect approved this separation. The two seams are siblings, not a hierarchy.
- `EnvSecretStore.set` and `.delete` mutate the in-process environment only; they are not
  persisted across a restart, because the platform owns durable secret storage. This is
  honest by design rather than a silent fallback: the durable write path is the GCP adapter
  (`set` creates a secret and adds a version), and production deployments inject secrets
  through the platform. The env store is the local-dev default and the read path; it is not a
  durable writable vault.
- With the default env-backed store, a secret "reference" is the environment variable name
  and the value still lives in the platform-injected environment, which is the legitimate
  durable secret home, not a database row or `.replit`. The acceptance ("no secret value in
  any table or `.replit`") is about persisted application state and deployment config, both
  of which are clean; the platform secret store is the intended home and is out of that
  scope by design.

## Verification

- Typecheck and build are green across the workspace (exit 0 on both).
- The full suite is green at 478 tests (api-server 198 across 26 files, portal 149, cortex
  80, connectors 29, edge-agent 10, db 8, scripts 4). New this phase: the GCP adapter and
  provider-selection unit tests in `secretStore.test.ts` (ref-grammar rejection before any
  network call, the access/create/addVersion/delete request shapes, 404-to-null and
  409-tolerant behaviour, metadata-versus-env token sourcing with caching, bounded timeout,
  no value/token/body logging, and `SECRET_STORE_PROVIDER` selection), and the new
  `secretResolution.integration.test.ts` (authRef resolution through the store, plus the
  DB-wide sentinel sweep over every public text and jsonb column and the `.replit` scan).
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, and `.replit` is zero, and a per-row cast over every text and jsonb column in
  every public table is zero (`NOTICE: TOTAL DASH HITS IN DB DATA: 0`).
- Zero new npm dependencies (the Node global fetch, the existing pg, and workspace packages
  only).

## Remediation iterations

- The architect `evaluate_task` review first returned a blocking FAIL on acceptance
  criterion (c): the sentinel sweep only checked the three tables the refresh wrote, not
  every public text and jsonb column nor `.replit`, so a leak into an unrelated column or
  into deployment config would not have been caught. The acceptance test was extended to the
  strong form described above (catalogue-driven sweep over all public text-shaped columns
  with a non-empty-list guard, plus the `.replit` scan). On re-submission the architect
  returned PASS, confirming criterion (c) is now genuinely proven and that the sweep itself
  introduces no injection or false-pass risk (the sentinel is a generated `[a-z0-9-]`
  string, table and column identifiers come from the catalogue and are double-quoted, and
  the non-empty column-list assertion prevents an empty-catalogue vacuous pass). One
  non-blocking hardening was noted for later: generate the probe identifiers with a
  database-side `format('%I.%I', ...)` or `quote_ident` rather than string interpolation;
  it is not required for the project-controlled schema in this test.

## Gate

Phase Q is the final phase of the owner-authorized autonomous run of O, P, and Q. Execution
stops here for owner review of all three phases. The drift index, the rollup, and the V2
build report are updated to "A through Q".
