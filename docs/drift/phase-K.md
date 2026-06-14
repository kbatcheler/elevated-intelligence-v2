# Phase K: Tier 3, cryptographic isolation, no standing access, and the hash-chained provenance ledger

Phase id: K. Name: Tier 3 (Cryptographic Isolation, No Standing Access, Hash-Chained
Provenance). Milestone: yes (hard stop for owner review before Phase L).

Tier 3 is the SOC 2 hardening tier. It lands three capabilities, backend only: per-
tenant cryptographic isolation with crypto-shredding on key revocation, no standing
human access to raw signals with an owner-approved time-boxed break-glass grant, and
the provenance ledger upgraded from a plain table to an append-only per-tenant hash
chain. The portal surfaces for all three (security posture, break-glass screen,
connections screen, provenance panel) are Phase L and are not built here; every
acceptance item is proven by test, not by UI. This phase added zero npm dependencies
(node:crypto, the pg already in the lockfile, the global fetch, and workspace packages
only) and contains no em-dash or en-dash.

## Build summary

- **The KMS seam** (`artifacts/api-server/src/lib/security/kms.ts`). A `KmsRuntime`
  interface (`provisionTenantKey`, `wrapDek`, `unwrapDek`, `destroyKey`, `status`) with
  a local implementation and a swappable cloud/customer adapter. The local runtime
  holds one random 32-byte key-encryption key (KEK) per tenant in the durable
  `kms_local_keys` Postgres table and wraps and unwraps per-row data-encryption keys
  (DEKs) with AES-256-GCM under that KEK. Key material is never logged. The
  cloud/customer adapter returns "available, not connected" until a customer-managed
  key is configured; it never fabricates a wrap or a status.
- **Envelope encryption** (`artifacts/api-server/src/lib/security/signalCrypto.ts`).
  `encryptSignalValue` seals a value with a fresh random DEK under AES-256-GCM and
  wraps the DEK with the tenant KEK; the stored envelope is
  `{v, alg, keyRef, iv, tag, ct, wrappedDek}` written inside the existing
  `derived_signals.value` jsonb, so no schema column churn was needed. `isEnvelope`
  guards the shape, `decryptSignalValue` reverses it, and typed errors
  `CryptoShreddedError` and `SignalEncryptionError` make every failure loud. Plaintext,
  ciphertext, and keys are never logged.
- **Persist and the two reads** (the connected persist path, `signalRead.ts`, and the
  machine-grounding read). Persist validates the plaintext `DerivedSignalSet` first
  (the guard is unchanged), requires an active tenant key for connected tenants, and
  encrypts each value before insert; the derived-set root hash is still computed over
  the plaintext math. Both reads require an active `tenant_keys` row before decrypting
  and verify that each envelope's `keyRef` matches that active key, so a missing key, or
  an envelope sealed under a different key, is refused rather than trusted on its own
  embedded reference. The in-boundary machine-grounding read decrypts for the pipeline
  only and is a separate service API; the human raw-signal read
  (`readDecryptedSignalsForHuman`) is a distinct API gated by break-glass. Neither read
  is a relaxation of the other.
- **Tenant key lifecycle** (`tenantKeyService.ts` plus owner-only routes in
  `routes/security.ts`). Provision creates and activates a tenant key; status reads
  provisioned/active/revoked plus the KMS provider; revoke destroys the KEK material
  first and only then commits `tenant_keys.status` as revoked and stamps `revokedAt`, so
  a revoked status is never observable while the material survives (a failed destroy
  throws before any status change), and the revocation is emitted as a structured log
  line. Signal rows are not deleted: the ciphertext is left inert and the key is what
  dies.
- **Break-glass, no standing access** (`breakGlass.ts` plus the new `access_grant_events`
  table). `requireActiveBreakGlassGrant(user, tenant, now)` requires an active,
  unexpired, unrevoked grant for every role, owners included, before a human raw-signal
  read; `logSignalAccess` appends an event row tied to the grant and the user on every
  access. Owners create (time-boxed) and revoke grants. The pipeline machine read stays
  exempt through its own service API.
- **The provenance ledger** (`artifacts/api-server/src/lib/provenance/ledger.ts`). An
  append-only per-tenant hash chain exposing only `appendEntry` and `verifyChain` (no
  update, no delete). Appends serialize on a Postgres transaction-scoped advisory lock
  per tenant (`pg_advisory_xact_lock` keyed off the tenant id hash); the chain tail is
  found with a `NOT EXISTS` self-join; `contentHash = sha256(canonical({tenantId,
  claimPath, sourceRef, prevHash}))` and `prevHash` is the prior entry content hash. The
  orchestrator writes entries after `tenantLayers` insert and before the run is marked
  done, over the verified and modelled claim paths using source and provenance
  references only (claimPath and sourceRef are dash-stripped before store), never raw
  client data; a throw fails the layer loudly.

## Requirements checklist

- Per-tenant cryptographic isolation with customer-managed keys. Done: a distinct
  per-tenant KEK wraps per-row DEKs; the customer-managed path is a swappable adapter
  that reads "available, not connected" until configured.
- Crypto-shredding on revocation. Done: revoke destroys the KEK before it commits the
  revoked status and leaves the ciphertext inert, so both the human and machine reads
  then fail with a typed `crypto_shredded` error. A failure-injection test proves a
  failed destroy leaves no misleading revoked state. Proven end to end.
- No standing human access with break-glass. Done: a human raw-signal read needs tenant
  access plus an active grant for every role including owners; expiry and revoke both
  deny; every access writes an event.
- Provenance ledger append-only and hash-chained. Done: only `appendEntry` and
  `verifyChain` are exported, per-tenant chain serialized on an advisory lock, tamper or
  reorder breaks `verifyChain`.
- outside_in byte-for-byte unchanged. Done: outside_in tenants have no derived signals,
  no tenant key, and no encryption; the grounding regression test still proves identical
  prompts.
- Never fake telemetry. Done: the customer KMS reads "available, not connected"; no
  capability is stubbed with a fabricating value.
- Zero new npm deps; no em-dash or en-dash. Done: node:crypto, pg, global fetch, and
  workspace packages only; the source guard and the all-tables DB sweep are both zero.

## New tables

- `kms_local_keys`: the durable store for the local KMS per-tenant KEK material (the
  KMS deviation below). Keyed by kmsKeyRef.
- `access_grant_events`: one row per raw-signal access under a break-glass grant
  (id, grantId FK, userId, tenantId, action, detail, createdAt). `access_grants` records
  the grant; this records every use of it, which a single grants table cannot.

## Logged drift and deviations

- Local KMS is a software key store, not an HSM. The default KMS keeps the per-tenant
  KEK in operator-controlled Postgres (`kms_local_keys`), in the same database as the
  ciphertext it protects (`derived_signals`), rather than in dedicated key hardware. The
  isolation and crypto-shred guarantees hold for the live store, but co-locating KEK and
  ciphertext means the local stand-in does not defend against a database-admin compromise
  or against a backup or snapshot taken before revocation that captures both; a real
  cloud KMS or a true bring-your-own-key arrangement, where the KEK never enters our
  database, implements the same `KmsRuntime` interface and drops in with no envelope or
  call-site change and closes that gap. This is the deliberate Tier 3 local-KMS
  limitation, surfaced for the owner.
- One per-tenant KEK, not a global master with HKDF derivation. Crypto-shred must destroy
  exactly one tenant's ability to decrypt; a shared master could not be shredded per
  tenant. The cost is one key per tenant to manage, which is the correct trade for the
  shred guarantee.
- Envelope stored inside the existing `derived_signals.value` jsonb, no new ciphertext
  column. The table shape is unchanged; only the persist and read paths change.
- Provenance append-only is an application-level guarantee (the exported surface plus the
  hash chain plus the serialized append). Database-role append-only (revoking UPDATE and
  DELETE on the table) is a deployment-time hardening left to the operator and does not
  change the application contract.
- Acceptance proven by test, not UI. The phase is backend only and the Playwright testing
  skill is for UI flows and explicitly not for API-only verification, so it does not
  apply; the unit and integration suites are the acceptance evidence.

## Verification

- Typecheck and build are green across the workspace.
- The full suite is green: 123 tests across 15 files (up from 96), with 27 new this
  phase. `signalCrypto.test.ts`: envelope round-trip, wrong/missing-key, keyRef-mismatch,
  and legacy-plaintext typed errors, GCM tamper detection.
  `tenantKeyService.integration.test.ts`: revoke failure-injection (a failed KEK destroy
  leaves no misleading revoked state) and the real crypto-shred lifecycle.
  `provenance/ledger.test.ts`: chain
  order, tamper detection, the append-only surface, verifyChain on clean and corrupted
  chains. `routes/security.integration.test.ts`: owner-only key lifecycle, no standing
  access for any role, grant enables read and every access is logged, expiry and revoke
  both deny, owner-only provenance verify, and the crypto-shred read failure, all over
  real HTTP against real Postgres.
- outside_in is unchanged: the grounding regression test still proves byte-for-byte
  identical prompts.
- Fail-loud honesty: revoked or missing key, legacy plaintext, missing or expired or
  revoked grant, and unconfigured customer KMS all surface as typed errors or an
  "available, not connected" status, never a silent empty result or a fabricated value.
- Zero new npm dependencies.
- Long-dash sweep zero across source (the guard over lib, artifacts, docs, and scripts)
  and data (a row-cast sweep over all 24 public tables, now including `kms_local_keys`
  and `access_grant_events`, returns zero em-dash and en-dash hits).

## Gate

Phase K is a milestone hard-stop. Execution pauses here for owner review before Phase L
(the portal connected-mode and security screens). Do not auto-advance.
