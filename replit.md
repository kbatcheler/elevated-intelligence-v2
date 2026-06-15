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

## Retention and deletion (Phase S)

Derived signals are ephemeral by design: each refresh supersedes the prior set and resets
its `computedAt`, so a signal "not refreshed within the TTL" is one whose `computedAt` has
fallen behind the cutoff. Two paths live in
`artifacts/api-server/src/lib/retention/retention.ts`:

- A scheduled TTL purge (`runRetentionPurge`) removes signals older than the configured age
  and writes one `ttl_purge` audit row per affected tenant; a tick that purges nothing
  writes no row. It mirrors the connector-maintenance and notifier loops: started ONLY from
  the server entrypoint (`startRetentionPurge` in `index.ts`), never overlapping, swallowing
  a tick failure, with an unref'd timer. TTL defaults to 90 days, overridable with
  `RETENTION_TTL_DAYS` (positive integer days); the purge cadence defaults to 6 hours,
  overridable with `RETENTION_PURGE_INTERVAL_MS`.
- An operator-authorized erasure (`eraseTenantDerivedSignals`) deletes a tenant's derived
  signals and, in the SAME transaction, appends an append-only provenance redaction
  (`claimPath` `redaction:derived_signals:tenant`, `sourceRef` a `sha256:` digest over the
  erased ids, provenance refs, count and scope) and writes a `tenant_erasure` audit row. The
  ledger is never mutated or trimmed, so `verifyChain` still passes. Token-scoped erasure is
  deliberately unsupported: derived signals are aggregate math with no identity thread, so a
  `tokenRef` is rejected with `token_erasure_not_supported_for_aggregate_signals` rather than
  silently widened to a full tenant erasure.

Erasure is owner-only over HTTP (`DELETE /api/retention/tenants/:id/derived-signals`), and
the audit is readable at `GET /api/retention/tenants/:id/events`. Every purge and erasure is
recorded in `retention_events` with what, when, and on whose authority (a scheduled purge's
authority is the system itself; an erasure records the authorizing owner).

## Backups and disaster recovery (Phase U)

The platform owns durable Postgres storage and point-in-time recovery; the application
documents those targets and the operator responsibility (the same honesty boundary the
SecretStore draws around durable secret storage) and builds the parts it can make real. The
full runbook, with RPO/RTO and the logical-restore-vs-PITR distinction, is
`docs/backup-and-dr-runbook.md`.

Two application paths live in `artifacts/api-server/src/lib/backups/`:

- The crown-jewel logical backup and a PROVEN scratch restore (`crownJewels.ts`). The crown
  jewels are the five tables whose loss could not be recomputed: `derived_signals`,
  `provenance_ledger`, `users`, `invite_pins`, and `tenant_keys` (the `kmsKeyRef` REFERENCE
  only, never key material). `exportCrownJewels` serialises each table with `row_to_json`;
  `restoreCrownJewelsIntoScratch` rebuilds them into an isolated `scratch_restore_*` schema in
  the same database (`CREATE TABLE ... LIKE ... INCLUDING DEFAULTS INCLUDING CONSTRAINTS`, no
  FKs or indexes, so it can never collide with live data); `runRestoreDrill` exports, restores,
  verifies the row counts and re-walks every restored tenant chain, then always drops the
  scratch schema even on failure. The bundle never holds a secret value, only ciphertext,
  one-way hashes, and references.
- The provenance ledger archive (`ledgerArchive.ts`). `exportLedgerArchive` writes a canonical,
  stable-order serialisation of the whole ledger plus a per-tenant chain manifest to durable
  object storage, with a `sha256` over the content-only canonical bytes (no wall-clock field,
  so an unchanged ledger is skipped rather than re-archived). It re-verifies every tenant chain
  at export, writes write-once where supported, and records exactly one `backup_events` audit
  row per archive run (action, object key, digest, entry and tenant counts, chain-verify
  result, authority). `verifyLedgerArchiveObject` reads an object back and re-confirms the
  digest over the actual bytes and re-walks each chain. An empty or unchanged ledger writes no
  object and no row, returning `skipped`.

The archive store is "available, not connected" by default, mirroring `gcpSecretStore`
(`archiveStore.ts`, `gcsArchiveStore.ts`): `ARCHIVE_STORE_PROVIDER` unset or `local` uses a
local-filesystem store (so the archive and restore cycle are provable on a laptop); `gcs`
selects the zero-SDK GCS JSON-API adapter over the Node global fetch, which validates nothing
at construction and throws a precise "set GCS_ARCHIVE_BUCKET to connect it" error on first use.

The scheduled archive loop (`backupLoop.ts`, `startBackupArchive`) is started ONLY from the
server entrypoint (`index.ts`), mirroring the retention and notifier loops: no overlap, swallow
a tick failure, unref'd timer. The owner-only routes (`/api/backups`, behind `requireAuth` and
`requireOwner`) are `POST /ledger-archive` (trigger), `GET /events` (audit history), and
`GET /status` (store provider and connection state, cadence, last archive; never a credential,
bucket, or path).

Backup/DR env (all optional):

- `ARCHIVE_STORE_PROVIDER` is `local` (default) or `gcs`.
- `ARCHIVE_LOCAL_DIR` pins the local-fs archive directory (defaults to a temp dir).
- `BACKUP_ARCHIVE_INTERVAL_MS` sets the scheduled archive cadence (default 12 hours).
- `GCS_ARCHIVE_BUCKET` is required to connect the GCS adapter; its absence is the
  available-not-connected error.
- `GCS_ARCHIVE_ENDPOINT` overrides the GCS JSON API endpoint (defaults to the public one).
- `GCS_ARCHIVE_TIMEOUT_MS` bounds every GCS request (default 10000).
- `GCS_ARCHIVE_TOKEN_SOURCE` is `metadata` (default) or `env`.
- `GCS_ARCHIVE_ACCESS_TOKEN` is required only when the token source is `env`.

## Working with this repo

- Run checks through the configured workflows (`typecheck`, `build`, `test`), not a direct
  ad-hoc command, then read the flushed logs. The full suite is the regression gate.
- Owner secrets (`OWNER_EMAIL`, `OWNER_PASSWORD`, `SESSION_SECRET`) are injected into the
  workflow processes only, not the agent shell, so live owner behaviour is verified through
  the integration suite and the bootstrapped owner row rather than an interactive login.

## User preferences

- (none recorded yet)
