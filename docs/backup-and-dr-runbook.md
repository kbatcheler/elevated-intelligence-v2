# Backup and disaster-recovery runbook (Phase U)

This runbook covers what Elevated Intelligence V2 backs up, what the operator is
responsible for, the recovery targets, and the exact steps to prove a restore. It
draws the same honesty boundary the SecretStore draws around durable secret
storage (Phase Q): the platform owns durable Postgres storage and point-in-time
recovery, so this document names those targets and the operator responsibility
precisely, and the parts the application can make real (a logical crown-jewel
backup with a proven scratch restore, and a tamper-evident ledger archive) are
built and tested in code.

## What is backed up

### 1. Managed Postgres (operator responsibility, platform-owned durable storage)

The primary store is Postgres. Durable storage, automated snapshots, and
point-in-time recovery (PITR) are provided by the managed Postgres platform, NOT
by application code. The operator is responsible for confirming that the managed
database has:

- automated daily base backups retained for the retention window below, and
- write-ahead-log (WAL) archiving enabled so PITR to an arbitrary point inside the
  window is possible.

This is the same framing as the SecretStore: the application does not reimplement
a durable vault it cannot honestly own; it documents the target and builds the
seam. A logical export and a proven restore of the crown-jewel tables (below) sit
on top of, and do not replace, the platform PITR.

### 2. Crown-jewel logical backup (application, provable on one instance)

The crown jewels are the tables whose loss could not be recomputed by re-running
the pipeline:

- `derived_signals` (encrypted per-tenant signal envelopes),
- `provenance_ledger` (the append-only hash chain),
- `users` (scrypt password hashes only),
- `invite_pins` (HMAC PIN hashes only),
- `tenant_keys` (the `kmsKeyRef` REFERENCE only, never key material).

The logical export (`exportCrownJewels`) serialises each table to a portable bundle
with `row_to_json`, so it stays correct as columns are added. The bundle never
holds a secret VALUE: only ciphertext, one-way hashes, and references. The KEK
material itself is deliberately out of scope here; it lives behind the separate KMS
boundary (Phase K) and has a different blast radius.

### 3. Provenance ledger archive (application, durable object storage)

The append-only, hash-chained provenance ledger is both the product's provenance
feature and the audit's processing-integrity evidence, so it is exported to durable
object storage on a schedule (`exportLedgerArchive`). The archive:

- carries a canonical, stable-order serialisation of every ledger row plus a
  per-tenant chain manifest, so the same ledger state always produces the same
  bytes;
- records a `sha256` over those canonical bytes (content only, no wall-clock field,
  so an unchanged ledger is detected and skipped rather than re-archived);
- re-verifies every tenant chain at export time and records the result;
- is written write-once where the store supports it (the GCS adapter sets
  `ifGenerationMatch=0`), so an archive object cannot be silently overwritten.

This doubles as a tamper-evidence archive that survives database loss: a restore can
re-read the object, re-confirm the recorded `sha256` over the actual bytes, and
re-walk every chain (`verifyLedgerArchiveObject`).

The archive store is "available, not connected" by default, mirroring
`gcpSecretStore`:

- `ARCHIVE_STORE_PROVIDER` unset or `local` (the dev default): a local-filesystem
  store under `ARCHIVE_LOCAL_DIR` (a temp dir by default), so the archive and the
  restore cycle are genuinely provable on a laptop.
- `ARCHIVE_STORE_PROVIDER=gcs`: the zero-SDK GCS JSON-API adapter over the Node
  global fetch. It validates nothing at construction and throws a precise
  "available, not connected: set GCS_ARCHIVE_BUCKET to connect it" error on first
  use when the bucket is missing.

## Recovery targets

These are the operator-facing targets the managed platform must meet; the
application's job is to make them auditable, not to provide the durable storage.

- RPO (recovery point objective): 24 hours from the managed daily base backup, or
  tighter (down to minutes) where the platform's WAL-based PITR is enabled. The
  ledger archive's own RPO is the archive interval (`BACKUP_ARCHIVE_INTERVAL_MS`,
  default 12 hours), so the tamper-evident chain copy is at most that stale.
- RTO (recovery time objective): 4 hours to restore the managed database to a chosen
  point and bring the API back up. The crown-jewel logical restore into a scratch
  schema is minutes; a full database PITR is bounded by the platform restore time.
- Retention window: 30 days of base backups plus WAL, aligned with the derived-signal
  TTL default of 90 days (Phase S) so a restore never resurrects data the retention
  policy would already have purged beyond its own window.

## Logical restore vs. PITR (the distinction, stated honestly)

These are two different recovery tools and the runbook does not conflate them:

- A platform PITR rebuilds the ENTIRE database to a chosen wall-clock instant. It is
  the tool for "the database is gone or corrupted". It is operator-driven through the
  managed platform and is NOT something application code performs.
- A crown-jewel LOGICAL restore (`restoreCrownJewelsIntoScratch`) rebuilds only the
  five crown-jewel tables, into an isolated scratch SCHEMA in the same database, from
  a portable bundle. It is the tool for "prove the backup is restorable and the chain
  survives", for extracting a subset, or for validating a bundle before trusting it.
  It is self-contained (`CREATE TABLE ... LIKE ... INCLUDING DEFAULTS INCLUDING
  CONSTRAINTS`, no foreign keys or indexes) so it can never collide with live data,
  and the scratch schema is always dropped afterward, even on failure.

## Proving a restore (the drill)

The drill is real and runs against the live Postgres, not a stub:

1. `runRestoreDrill()` exports the crown jewels, restores them into a fresh
   `scratch_restore_*` schema, verifies that every table's restored row count equals
   the exported count (`countsMatch`), re-walks every restored tenant provenance
   chain (`chainVerified`), then drops the scratch schema.
2. The backups integration suite proves the same end to end against a real database,
   and additionally re-verifies a known tenant's three-entry chain out of the live
   scratch table (not the in-memory bundle), so the verification is over genuinely
   restored rows. It also confirms no scratch schema residue remains afterward.

To run the drill on demand:

```
pnpm --filter @workspace/api-server exec tsx -e "import('./src/lib/backups/crownJewels').then(async m => { const r = await m.runRestoreDrill(); console.log(JSON.stringify(r, null, 2)); process.exit(0); })"
```

A healthy drill prints `countsMatch: true` and `chainVerified: true` for every
crown-jewel table and leaves no scratch schema behind.

## The ledger archive on a schedule

The scheduled archive loop (`startBackupArchive`) is started ONLY from the server
entrypoint (`index.ts`), never from `app.ts`, so importing the app in a test never
starts a timer. It mirrors the retention purge and the alert notifier loops exactly:
ticks never overlap, a tick failure is logged and never crashes the loop, and the
timer is unref'd. Each tick archives the ledger, skipping honestly when the ledger
is empty or unchanged since the last archive.

Owner-only HTTP surface (`/api/backups`, behind `requireAuth` and `requireOwner`):

- `POST /api/backups/ledger-archive` triggers an archive now and returns the honest
  result (`archived` with the object key and digest, or `skipped` with a reason).
- `GET /api/backups/events` returns the backup audit history: one row per archive run
  with the action, object key, digest, entry and tenant counts, chain-verify result,
  and the authority (the system for a scheduled run, the owner for a manual one).
- `GET /api/backups/status` returns the store provider and connection state, the
  archive cadence, and the most recent archive event. It never returns a credential,
  a bucket name, or a path.

## Environment variables

- `ARCHIVE_STORE_PROVIDER`: `local` (default) or `gcs`.
- `ARCHIVE_LOCAL_DIR`: local-fs archive directory (default: a temp dir).
- `BACKUP_ARCHIVE_INTERVAL_MS`: scheduled archive cadence (default 12 hours).
- `GCS_ARCHIVE_BUCKET`: required to connect the GCS adapter; its absence is the
  available-not-connected error.
- `GCS_ARCHIVE_ENDPOINT`: overrides the GCS JSON API endpoint (defaults to the public
  one).
- `GCS_ARCHIVE_TIMEOUT_MS`: bounds every GCS request (default 10000).
- `GCS_ARCHIVE_TOKEN_SOURCE`: `metadata` (default, cached GCP metadata token) or `env`.
- `GCS_ARCHIVE_ACCESS_TOKEN`: required only when the token source is `env`.

## Operator checklist

- [ ] Confirm managed Postgres daily base backups and WAL/PITR are enabled and meet
      the retention window.
- [ ] Set `ARCHIVE_STORE_PROVIDER=gcs` and `GCS_ARCHIVE_BUCKET` (plus a token source)
      in production so the ledger archive is durable off the database host.
- [ ] Confirm the scheduled archive is running (`GET /api/backups/status` shows a
      recent `lastArchive`).
- [ ] Run the restore drill on a cadence and confirm `countsMatch` and
      `chainVerified` are both true with no scratch residue.
