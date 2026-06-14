# Elevated Intelligence V2

A connectors, SOC 2, and operations monorepo (pnpm workspace) that grounds a multi-model
"cortex" on real, per-tenant data through a no-write derive-and-discard connector boundary,
with cryptographic per-tenant isolation, hash-chained provenance, cost and token
observability, operational alerting, and a managed secrets seam.

## Hard constraints (every change must hold these)

- Zero new npm dependencies. Use workspace packages and Node built-ins only. Integrate
  external services over HTTP through "available, not connected" adapters that mirror the
  KMS pattern (construct without validating, fail loudly and lazily on first use, never
  crash the boot), not SDKs.
- ASCII hyphen only. Never an em-dash (U+2014) or en-dash (U+2013), in source OR in
  database data. A source guard and a database-wide row sweep both enforce this; both must
  read zero before a phase is done.
- Never fabricate telemetry, health, or output. A figure is computed from persisted state
  or it is not shown. Loading, empty, and error states are honest and distinct.
- Per-phase drift protocol. `docs/drift/INDEX.md` is the source of truth for build progress;
  each phase gets a `docs/drift/phase-<id>.md`, appends to `docs/build-report-v2.md`, and
  updates the INDEX and `docs/drift/rollup.md` to the new last phase.

## Layout

- `lib/` workspace packages: `cortex` (the multi-model pipeline, pricing, schemas),
  `connectors` (the uniform connector contract, registry, and reference connectors), `db`
  (schema and the derive-and-discard contracts), `edge-agent` (the in-client connector
  runner).
- `artifacts/` deployables: `api-server` (Express API, auth, orchestration, connectors
  runtime, secrets, observability), `portal` (the per-tenant UI), `edge-agent`.
- `scripts/` workspace tooling, including the em-dash/en-dash source guard.
- `docs/` the build reports and the `drift/` protocol records.

## Secrets and the SecretStore (Phase Q)

Every secret is referenced by name and resolved through the `SecretStore` seam
(`artifacts/api-server/src/lib/secrets/secretStore.ts`), never read from `process.env` at
the call site. `getSecretStore()` selects the backend from `SECRET_STORE_PROVIDER`:

- unset or `env` (the default): the local env-backed store. It reads `process.env`; its
  `set`/`delete` mutate the in-process environment only and are not durable across a restart
  (honest by design, because the platform owns durable secret storage). This is the
  local-dev default and the read path, not a durable writable vault.
- `gcp`: the GCP Secret Manager REST adapter
  (`artifacts/api-server/src/lib/secrets/gcpSecretStore.ts`), zero SDK, over the Node global
  fetch. It is "available, not connected" until configured: construction validates nothing,
  and the first `get`/`set`/`delete` throws a precise "set GCP_PROJECT_ID to connect it"
  error if the project is missing. This is the durable write path.

GCP adapter env (all optional and lazy):

- `GCP_PROJECT_ID` is required to connect; its absence is the available-not-connected error.
- `GCP_SECRET_MANAGER_TOKEN_SOURCE` is `metadata` (default, uses the cached GCP metadata
  token) or `env` (uses `GCP_SECRET_MANAGER_ACCESS_TOKEN`).
- `GCP_SECRET_MANAGER_ACCESS_TOKEN` is required only when the token source is `env`.
- `GCP_SECRET_MANAGER_ENDPOINT` overrides the API endpoint (defaults to the public one).
- `GCP_SECRET_MANAGER_TIMEOUT_MS` bounds every request (default 5000).

What is resolved through the store:

- `SESSION_SECRET` via `requireSecret` in the auth middleware, the auth and admin routes,
  the PIN pepper derivation, and the connected-refresh token salt. Rotating it invalidates
  every outstanding PIN.
- `OWNER_PASSWORD` via `store.get` at owner bootstrap; only the scrypt hash is persisted,
  never the plaintext.
- Connector credentials via `buildConnectorContext.resolveSecret`, which the warehouse
  connector uses to resolve its `scope.authRef`. `tenant_connections` stores only the
  `authRef` reference, never a credential value.

What is deliberately NOT in the SecretStore: `tenant_keys.kmsKeyRef`. The per-tenant KEK is
the root of the crypto-shred guarantee and has a different blast radius from an API
credential, so it keeps its own KMS boundary (`lib/security/kms.ts`) with its own swappable
cloud/customer adapter. The two seams are siblings, not a hierarchy.

No secret VALUE is ever persisted to a database column or to `.replit`; only references
(env var names, `authRef`, `kmsKeyRef`) and one-way hashes are stored. An acceptance test
sweeps every public text and jsonb column plus `.replit` for a resolved sentinel and
asserts none is present.

## Working with this repo

- Run checks through the configured workflows (`typecheck`, `build`, `test`), not a direct
  ad-hoc command, then read the flushed logs. The full suite is the regression gate.
- Owner secrets (`OWNER_EMAIL`, `OWNER_PASSWORD`, `SESSION_SECRET`) are injected into the
  workflow processes only, not the agent shell, so live owner behaviour is verified through
  the integration suite and the bootstrapped owner row rather than an interactive login.

## User preferences

- (none recorded yet)
