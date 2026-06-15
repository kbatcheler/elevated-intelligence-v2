# Phase U: backups and disaster recovery

Phase id: U. Name: Backups and disaster recovery. Milestone: no (gated; the second-to-last
phase of Stage 3, run back to back with V and W under owner authorization, the hard stop is
after W before milestone X). This phase added zero npm dependencies and contains no em-dash or
en-dash in source or in data.

Adaptation note: the platform owns durable Postgres storage and point-in-time recovery, so
Phase U mirrors the framing Phase Q drew around durable secret storage. It documents the
targets and the operator responsibility (RPO, RTO, the retention window, the logical-restore
versus PITR distinction) in `docs/backup-and-dr-runbook.md`, and it builds the parts the
application can make genuinely real: a crown-jewel logical export with a PROVEN scratch
restore, a provenance-ledger archive to durable object storage with a verifiable chain copy, a
scheduled archive loop, an audit table, and owner-only routes.

## What Phase U built

- `lib/db/src/schema/backupEvents.ts`: a new `backup_events` audit table mirroring
  `retention_events` (a `backup_action` enum, set-null `tenantId` and `authorityUserId` so the
  audit outlives what it records, an `authorityRole`, the object key, the `sha256` digest, the
  entry and tenant counts, the chain-verify result, a `scope` jsonb, and `createdAt`, with read
  indexes). One row is written per archive run, never on a skipped (empty or unchanged) run.
- `artifacts/api-server/src/lib/backups/crownJewels.ts`: the crown-jewel logical backup and the
  proven scratch restore. The crown jewels are the five tables whose loss could not be
  recomputed: `derived_signals`, `provenance_ledger`, `users`, `invite_pins`, and `tenant_keys`
  (the `kmsKeyRef` REFERENCE only, never key material). `exportCrownJewels` serialises each
  table with `row_to_json`; `restoreCrownJewelsIntoScratch` rebuilds each into an isolated
  `scratch_restore_*` schema in the same database (`CREATE TABLE ... LIKE ... INCLUDING DEFAULTS
  INCLUDING CONSTRAINTS`, no FKs or indexes, so it can never collide with live data);
  `runRestoreDrill` exports, restores, verifies the per-table row counts, re-walks every
  restored tenant chain, then always drops the scratch schema even on failure. The chain
  verification reads back the RESTORED `provenance_ledger` rows out of the scratch schema
  (`restoredLedgerRowsByTenant`) and re-walks them with `verifyLedgerEntries`, so a green
  `chainVerified` is proof the chain survived the round-trip, not a restatement of the in-memory
  export bundle. The bundle never holds a secret value, only ciphertext, one-way hashes, and
  references.
- `artifacts/api-server/src/lib/backups/ledgerArchive.ts`: the provenance-ledger archive.
  `exportLedgerArchive` writes a canonical, stable-order serialisation of the whole ledger plus
  a per-tenant chain manifest to durable object storage, with a `sha256` over the content-only
  canonical bytes (no wall-clock field, so an unchanged ledger is skipped rather than
  re-archived). It re-verifies every tenant chain at export, writes write-once where the store
  supports it, and records exactly one `backup_events` row per archive run.
  `verifyLedgerArchiveObject` reads an object back and re-confirms the digest over the actual
  bytes and re-walks each chain. An empty or unchanged ledger writes no object and no row,
  returning `skipped`.
- `artifacts/api-server/src/lib/backups/archiveStore.ts` and `gcsArchiveStore.ts`: the archive
  store is "available, not connected" by default, mirroring `gcpSecretStore`.
  `ARCHIVE_STORE_PROVIDER` unset or `local` uses a local-filesystem store (so the archive and
  restore cycle are provable on a laptop); `gcs` selects the zero-SDK GCS JSON-API adapter over
  the Node global fetch, which validates nothing at construction and throws a precise "set
  GCS_ARCHIVE_BUCKET to connect it" error on first use. Every object key is validated against a
  traversal-safe grammar before any call.
- `artifacts/api-server/src/lib/backups/backupLoop.ts`: `startBackupArchive` runs the scheduled
  archive loop from the server entrypoint only (`index.ts`), mirroring the retention and
  notifier loops: no overlap, swallow a tick failure, unref'd timer; cadence via
  `BACKUP_ARCHIVE_INTERVAL_MS` (default 12 hours).
- `artifacts/api-server/src/routes/backups.ts`: the owner-only routes behind `requireAuth` and
  `requireOwner`: `POST /api/backups/ledger-archive` (trigger), `GET /api/backups/events`
  (audit history), and `GET /api/backups/status` (store provider and connection state, cadence,
  last archive; never a credential, bucket, or path).
- `docs/backup-and-dr-runbook.md`: the runbook with RPO, RTO, the retention window, the
  logical-restore versus PITR distinction, and the operator checklist.

## The honesty constraint

The status route reports only the real store provider and its connected state, never a bucket,
path, or credential. A skipped archive (empty or unchanged ledger) writes no object and no
audit row, so a reader never sees an archive that did not happen, and the digest is over the
content-only canonical bytes so an unchanged ledger is genuinely skipped rather than
re-written with a new timestamp. The crown-jewel bundle and the ledger archive carry only
ciphertext, one-way hashes, and references, never a secret value. The restore drill verifies
counts and re-walks the chain from the RESTORED rows, so a green result is earned by real
round-tripped data; the scratch schema is always dropped, even on failure, so a drill leaves
no residue. The GCS adapter is honest about being unconnected (a precise lazy error), never a
fabricated success.

## Acceptance checklist

1. Backups run on schedule. Met: `startBackupArchive` runs the loop from `index.ts` only, no
   overlap, swallowed tick failure, unref'd timer, cadence via `BACKUP_ARCHIVE_INTERVAL_MS`;
   the manual `POST /api/backups/ledger-archive` exercises the same path and is covered by the
   backups integration suite.
2. A restore into a scratch environment succeeds. Met: `runRestoreDrill` exports the crown
   jewels, restores them into an isolated `scratch_restore_*` schema, asserts every per-table
   count matches, re-walks every restored tenant chain from the restored rows, and drops the
   scratch schema. `crownJewels.integration.test.ts` proves the counts match, that the scratch
   schema is dropped even on the happy path, and (deterministically, on its own seeded tenant
   read back out of the live scratch schema) that the restored ledger rows verify.
3. The ledger archive contains a verifiable copy of the chain. Met: `exportLedgerArchive`
   writes the canonical ledger plus the per-tenant chain manifest with a `sha256` over the
   content bytes and re-verifies every chain at export; `verifyLedgerArchiveObject` reads the
   object back and re-confirms both the digest and every chain. The backups integration suite
   round-trips an archive and re-verifies it.
4. The audit is honest. Met: exactly one `backup_events` row per archive run, none on a skipped
   run; the row carries the action, object key, digest, entry and tenant counts, chain-verify
   result, and authority.
5. The runbook documents RPO, RTO, retention, and the restore procedure. Met:
   `docs/backup-and-dr-runbook.md`.
6. Zero new npm dependencies. Met: the adapters use the Node global fetch and built-ins only.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 557 tests (api-server 258 across 32 files, portal 164, cortex 84,
  connectors 29, edge-agent 10, db 8, scripts 4). New this phase: 31 api-server tests across
  three new test files, the `archiveStore` local-store unit suite, the crown-jewel restore-drill
  integration suite (`crownJewels.integration.test.ts`, 4 tests), and the combined
  ledger-archive plus owner-route integration suite (`backups.integration.test.ts`, combined so
  the `backup_events` writes stay sequential and clean up by collected digest).
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, `.replit`, and `.github` is zero, and a database-wide cast over every text and
  jsonb column in every public table (now including `backup_events`) reports zero hits.
- Zero new npm dependencies.

## Logged drift and deviations

- Backups and PITR are a documented platform responsibility, not application code. Like Phase Q
  drew the durable-secret-storage boundary, Phase U documents the RPO/RTO/retention targets and
  the operator restore procedure for platform-owned Postgres, and builds the application-real
  parts (the crown-jewel export and proven scratch restore, the ledger archive, the loop, the
  audit, the routes) on that base.
- The restore drill restores into a scratch SCHEMA in the same database, not a separate
  instance. This is the strongest restore proof the application can make on its own without a
  second managed database; it is isolated (a `scratch_restore_*` schema with no FKs or indexes,
  always dropped) so it can never collide with live data, and the runbook is explicit that a
  full PITR-to-new-instance drill is the operator's platform-level procedure.
- The skip-unchanged archive guard is not globally serialised across processes (LOW, accepted as
  logged drift on the architect's evaluate_task). The scheduled loop runs from one entrypoint
  and never overlaps itself; only a manual trigger racing the scheduled tick could produce a
  redundant archive. Because each object key embeds a compact timestamp plus a `sha256` prefix,
  a concurrent duplicate writes a DIFFERENT, content-identical key under write-once protection
  and a second honest, content-identical audit row, so integrity is never compromised, only a
  redundant object and row can appear. A database advisory lock or a unique-digest constraint
  would be an operational refinement, not a gate requirement; logged here rather than built.

## Gate

Phase U passed its architect `evaluate_task` review (PASS) after the first review's one MEDIUM
was fixed and re-verified: `runRestoreDrill` now computes `chainVerified` from the restored
scratch rows rather than the in-memory export bundle. The one LOW (skip-unchanged not globally
serialised) is accepted as logged drift above. The drift index, the rollup, and the V2 build
report are updated to "A through U". Per the owner-authorized run this does not pause; it
proceeds to Phase V (the Stage 3 closing verification). The hard stop is after Phase W, before
milestone X.
