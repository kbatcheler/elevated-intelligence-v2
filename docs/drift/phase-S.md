# Phase S: retention and deletion

Phase id: S. Name: Retention and deletion. Milestone: no, but gated (a per-phase hard stop
deferred because the owner authorized an autonomous run of R, S, and T back to back). T is
the milestone in this run; execution stops for owner review after T.

Scope note: Phase S is unchanged from the Operations prompt. It adds a configurable
time-to-live (TTL) purge of derived signals, an operator-authorized tenant erasure that
preserves the append-only provenance ledger by appending a redaction rather than deleting a
row, and an audit row for every purge and erasure. This phase added zero npm dependencies
and contains no em-dash or en-dash in source or in data.

## What Phase S built

- `lib/db/src/schema/retentionEvents.ts`: a new `retention_events` audit table. A
  `retention_action` enum carries the two kinds, `ttl_purge` and `tenant_erasure`. The row
  records `tenantId` and `authorityUserId` as set-null foreign keys (the audit survives the
  later deletion of the tenant or the operator), the `authorityRole`, a `scope` jsonb, a
  `deletedDerivedSignalCount` integer defaulting to zero, an optional `redactionLedgerEntryId`
  uuid (a plain pointer to the provenance redaction, deliberately not a foreign key so the
  ledger stays an independent append-only structure), a `reason`, and `createdAt`. Two
  indexes support the by-tenant and by-time reads. Exported from `schema/index.ts`.
- `artifacts/api-server/src/lib/provenance/ledger.ts`: refactored to expose `appendEntryTx`,
  which performs the same advisory-locked tail-read-then-insert append inside a caller's
  transaction, with `appendEntry` now a thin wrapper that opens its own transaction and calls
  it. A `LedgerTx` type names the transaction handle. The surface is still append-only: there
  is no update and no delete export, so an erasure that needs to append a redaction in the
  same transaction as its delete composes through `appendEntryTx` without the ledger ever
  gaining a mutation path.
- `artifacts/api-server/src/lib/retention/retention.ts`:
  - `getRetentionTtlDays()` reads `RETENTION_TTL_DAYS` (a positive integer number of days)
    and defaults to 90.
  - `runRetentionPurge()` deletes every derived signal whose `computedAt` has fallen behind
    the TTL cutoff (a refresh resets `computedAt`, so "not refreshed within the TTL" is
    exactly this predicate), returning the affected rows, and writes one `ttl_purge` audit
    row per affected tenant. A tick that purges nothing writes no audit row and logs nothing,
    so the ledger never holds an empty-tick artifact.
  - `eraseTenantDerivedSignals()` runs in a single transaction: it deletes the tenant's
    derived signals (returning their ids and provenance refs), computes a `sha256` digest
    over the sorted ids, the sorted provenance refs, the count, and the scope, appends a
    provenance redaction through `appendEntryTx` with `claimPath`
    `redaction:derived_signals:tenant` and `sourceRef` `sha256:<digest>`, and inserts a
    `tenant_erasure` audit row carrying the redaction entry id. Because the delete, the
    redaction append, and the audit insert share one transaction, an erasure is all or
    nothing, and `verifyChain` still passes afterward because the ledger only grew.
  - `startRetentionPurge()` runs the scheduled loop, reading `RETENTION_PURGE_INTERVAL_MS`
    (default 6 hours). It mirrors the connector-maintenance and notifier loops exactly:
    started only from the server entrypoint, never overlapping (a running tick is skipped),
    swallowing a tick failure so a transient error never crashes the process, and unref'ing
    its timer so it never holds the process open.
- `artifacts/api-server/src/routes/retention.ts`: an owner-only router.
  `DELETE /api/retention/tenants/:id/derived-signals` runs the erasure; a body carrying a
  `tokenRef` is rejected with a 400 and the code
  `token_erasure_not_supported_for_aggregate_signals` before any delete, and an unknown
  tenant returns a 404 `tenant_not_found`. `GET /api/retention/tenants/:id/events` returns
  the audit trail.
- Wiring: `retentionRouter` is mounted in `app.ts`, and `startRetentionPurge` is started from
  `index.ts` only, alongside the other maintenance loops.

## The honesty constraint

Every retention figure is computed from persisted state. The `deletedDerivedSignalCount` is
the real number of rows the delete returned, not an estimate; an empty TTL tick writes no row
rather than a zero-count row, so a reader never sees a purge that did not happen. The
redaction digest is a real `sha256` over the erased ids and provenance refs, so the ledger
records what was erased without retaining the erased values. The token-scoped erasure is
refused honestly rather than silently widened to a full tenant erasure (see the deviation
below). No test was made to pass by weakening an assertion; the ledger surface test was
widened to admit the new append-only helper while still asserting the absence of any update
or delete export.

## Acceptance checklist

1. A signal past TTL is purged on schedule. Met: `runRetentionPurge` deletes by the
   `computedAt < cutoff` predicate and the service integration test seeds a stale signal and
   a fresh signal, runs the purge, and asserts only the stale one is gone and a `ttl_purge`
   audit row was written for its tenant.
2. An erasure removes a tenant's derived signals and appends a ledger redaction without
   breaking the chain. Met: the test seeds signals and a provenance chain, erases the tenant,
   and asserts the signals are gone, a `redaction:derived_signals:tenant` entry was appended,
   `verifyChain` still returns ok, and a `tenant_erasure` audit row records the count and the
   redaction entry id.
3. Both are logged with what, when, and on whose authority. Met: every purge and erasure
   writes a `retention_events` row; a scheduled purge records the system as the authority, an
   erasure records the authorizing owner's id and role.
4. The erasure is owner-only and aggregate-safe. Met: the route integration test proves a
   client and a member each get 403, an owner succeeds, an unknown tenant is 404, and a
   `tokenRef` body is rejected with `token_erasure_not_supported_for_aggregate_signals`
   before any delete.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 495 tests (api-server 211 across 28 files, portal 149, cortex 84 across
  10 files, connectors 29, edge-agent 10, db 8, scripts 4). New this phase: 13 api-server
  tests (5 in the retention service integration suite, 8 in the retention route integration
  suite); the ledger surface test was widened to admit `appendEntryTx`.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, `.replit`, and `.github` is zero, and a database-wide cast over every text and
  jsonb column in every public table is zero (`NOTICE: TOTAL DASH HITS 0`, now including the
  new `retention_events` table).
- Zero new npm dependencies (the purge and erasure use the existing pg-backed db, the Node
  `node:crypto` digest, and workspace packages only).

## Logged drift and deviations

- Token-scoped erasure is deliberately unsupported for derived signals. The Operations
  prompt's S allows a token-scoped delete "within a tenant where identity threads exist", but
  derived signals are aggregate math with no identity thread, so a `tokenRef` is rejected with
  `token_erasure_not_supported_for_aggregate_signals` rather than silently widened to a full
  tenant erasure. The seam is honest about what it can and cannot scope; a future
  per-identity store would add a real token-scoped path rather than overloading this one.
- The provenance ledger is never trimmed. An erasure appends a redaction record rather than
  deleting the entries it references, so the hash chain stays intact and `verifyChain` keeps
  passing. The redaction is a statement that the referenced derived signals were erased, with
  a `sha256` digest over their ids and provenance refs as evidence, not the erased values.
- `appendEntryTx` is a new export on the ledger module. It is an append-only transaction
  composition helper, not a mutation path; the surface test asserts the module exports only
  `appendEntry`, `appendEntryTx`, and `verifyChain`, with no update and no delete. It must not
  be reverted; the erasure relies on appending the redaction in the same transaction as its
  delete.
- `redactionLedgerEntryId` on `retention_events` is a plain uuid pointer, not a foreign key,
  so the audit table and the provenance ledger remain independent structures and the audit
  never constrains or cascades into the ledger.

## Gate

Phase S passed its architect `evaluate_task` review (PASS, no blocking issues). Execution
continues to Phase T as part of the owner-authorized autonomous R-S-T run; Phase T is the
milestone, so the hard stop is after T. The drift index, the rollup, and the V2 build report
are updated to "A through S".
