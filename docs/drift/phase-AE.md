# Phase AE: the ingestion suite (five paths on one derive-and-discard core)

Phase id: AE. Name: Ingestion suite. Milestone: no (gated; the second phase of Stage 5, Platform
completion, run under the owner-authorized AE-through-AI Stage 5 sequence that pauses only at the
Phase AI milestone hard stop at the end of Stage 5).

Phase AE adds five inbound data paths that ALL terminate at ONE shared derive-and-discard core, so no
path can persist a raw artifact. The core (`lib/ingestion/ingestCore.ts`) parses the inbound bytes or
payload in memory, derives a `DerivedSignalSet`, enforces a non-identifying-metadata guard on every
signal's `key`, `window`, and `unit` (a short metric token only, never free text, an email, or other
identifying content; a violation is a mapped 400, not a 500), persists ONLY the derived math through
`persistDerivedSignalSet` (the same Phase H connector terminus, so each value is per-tenant encrypted
and the set is root-hashed), appends one provenance entry per target layer whose claim path records the
ingestion method and layer (`ingestion:<method>:<layer>`) and whose source ref is the derived-set root
hash over the math only (never the raw artifact), and discards the raw input. There is no raw-data
store, no raw column, and no temporary raw file kept after processing. Zero new npm dependencies; ASCII
hyphen only in source and in data.

## The five paths

1. Ingestion API (`POST /v1/ingest`). A per-tenant key lives in `ingestion_keys` as a scrypt hash
   only; the secret half is shown EXACTLY ONCE at mint and never stored in plaintext, the key is
   revocable, and the miss path (unknown or revoked key id) spends the same scrypt time so it does not
   leak validity by timing. The path is rate limited, and an OpenAPI document (`lib/ingestion/openapi.ts`)
   describes the contract. Integration-tested: `routes/ingest.integration.test.ts` (6) covers minting
   (provider only, token shown once), the key gate and revocation, derive-and-discard persisting
   encrypted numeric signals, a loud refusal of raw content, and an unknown-layer rejection.

2. Webhooks (per-source). A per-source signing secret lives in `webhook_sources` and is verified with
   a timing-safe HMAC; a bad or missing signature is refused before any derive runs. Integration-tested:
   `routes/webhooks.integration.test.ts` (5), including source minting (provider only, secret sealed
   and shown once) and the derive-and-discard terminus.

3. Manual upload. csv and xlsx files derive deterministic numeric math; pdf and docx contract text is
   extracted in memory, interpreted in the in-boundary extraction seat, and discarded, leaving only the
   numeric contract metrics. Spreadsheet signals carry GENERIC positional keys (`column_<n>`, 1-based),
   so a raw header label is never echoed into a stored signal key; the human header rides only in the
   transient derived-versus-discarded summary in the HTTP response and is never persisted.
   MIME, extension, and size are gated strictly, and the response carries an
   honest derived-versus-discarded account so the operator sees what was kept and what was thrown away.
   Integration-tested: `routes/upload.integration.test.ts` (9), covering the spreadsheet math, the
   contract path through the in-boundary seat, and malformed and oversized rejection. The contract path
   exercises the in-boundary extraction seat in the test; a live frontier model is not spent in the suite.

4. SFTP drop. A per-tenant credential and an inbound-directory watcher; each file is parsed through the
   shared core and DELETED whether it succeeds OR is rejected, so nothing lingers on disk (a rejected
   file is discarded with a loud logged reason, never parked as a ".rejected" raw copy), and a
   quiet-period guard waits until a file has stopped changing before processing it. Integration-tested:
   `lib/ingestion/sftpDrop.integration.test.ts` (5).

5. MCP server. An MCP endpoint exposing `submit_signals` plus `get_diagnosis`, `get_layer`, and
   `get_actions`, each under per-tenant auth, so an external MCP client can submit derived math and read
   back its diagnosis. Integration-tested: `routes/mcp.integration.test.ts` (10), driving the
   `initialize` handshake, the tool list, the derive-and-discard submit through the shared terminus, and
   the honest "none exists yet" reads.

## Raw-artifact absence (the central acceptance)

`routes/rawAbsence.integration.test.ts` (1) drives ALL FIVE paths with a single unique sentinel placed
in each path's raw position, then sweeps every public text and jsonb column across the whole schema (the
`information_schema` model used by the Phase Q secret sweep) plus the SFTP scratch directory, and asserts
the sentinel appears NOWHERE. A raw artifact stored anywhere by any path would fail this test. This is
the test-proven affirmation that no ingestion path persists raw data, which Part of the AE acceptance set
requires the drift report to affirm.

## Admin surface

The portal Access console gains an ingestion panel (`portal/src/lib/ingestionApi.ts`,
`components/admin/IngestionPanel.tsx`, wired into `components/AccessConsole.tsx`) to mint and revoke
ingestion keys and webhook sources with a one-shot secret reveal. The server endpoints behind it are
provider-gated and integration-tested (the minting and revocation cases above). The portal client itself
is source-reviewed, not covered by a new portal test (logged as an accepted LOW below).

## Test-infrastructure fixes made in this phase

Adding a sixth DB-touching integration file surfaced two latent test-harness faults that had to be fixed
to make the gate deterministic. Both are infrastructure, not product, changes:

- A real bug in the SFTP quiet-period guard (`sftpDrop.ts`): it compared an integer `Date.now()` against
  a sub-millisecond `mtimeMs`, which could yield a negative age and, with `quietMs` 0, wrongly skip a
  freshly written file. The fix clamps the age at zero (`Math.max(0, now - info.mtimeMs)`). The five SFTP
  tests now pass deterministically (confirmed green run alone and under the full suite).

- Intermittent HTTP 500s in whichever DB-touching test happened to be running under the full suite (it
  surfaced on `sftpDrop` and then on `push`, each passing in isolation). Root cause: the `test` workflow
  runs `pnpm -r run test`, which ran every package's vitest suite concurrently at the default workspace
  concurrency, and each forked test file opens its own connection pool; the combined fork count far
  exceeded the 8 CPUs (and the per-process pool cap of 20 across many forks can approach the database's
  112 connection ceiling), so a CPU-starved fork occasionally tripped the 10-second pool
  connection-acquisition timeout and returned a 500. The api-server suite run ALONE is green, which
  isolates the cause to cross-package oversubscription. Two coordinated fixes: the root `test` script now
  serializes the per-package runs (`--workspace-concurrency=1`), and `lib/db` bounds the per-process pool
  small under the test runner (`max` 5 when `VITEST` is set; the generous server default of 20 is
  unchanged for the real server, and an explicit `DATABASE_POOL_MAX` still wins in both). The full suite
  is now green under the serialized runner.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 794 tests (api-server 429 across 52 files, portal 225 across 18, cortex 89 across
  11, connectors 29 across 5, edge-agent 10 across 3, db 8, scripts 4), up 36 from Phase AD's 758. All
  36 new tests are in the six new api-server files: ingest 6, webhooks 5, upload 9, sftpDrop 5, mcp 10,
  and rawAbsence 1.
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase
  AE Markdown, and a fresh database-wide cast over all 143 public text and jsonb columns across 39 base
  tables (now including `ingestion_keys` and `webhook_sources`) reports zero hits.
- Zero new npm dependencies (Node built-ins, the already-present `pg`, the workspace packages).

## Honest marking

The five ingestion paths and the raw-artifact-absence sweep are TEST-PROVEN by integration tests that
run against live Postgres through the real app. The shared derive-and-discard core, the scrypt-hashed
revocable key store, the timing-safe webhook HMAC, the strict upload gating, the SFTP
delete-on-success-or-rejection, and the MCP tool surface are each covered by at least one of those tests. Source-reviewed rather than
test-proven (the accepted LOW): the portal ingestion admin client. No telemetry, health, or output
figure is fabricated by any path; a figure is computed from the parsed-then-discarded input or it is not
stored.

## Logged drift and deviations

- The portal ingestion admin client (`ingestionApi.ts`, `IngestionPanel.tsx`) is source-reviewed; no
  new portal test was added, so the portal total stays at 225. The server mint, revoke, and gate
  endpoints behind it ARE integration-tested. A future pass can add a portal client test, mirroring the
  existing `adminApi`/`securityApi` client tests.
- Two SHARED test-infrastructure changes were made to make the gate deterministic: the serialized
  `test` script (`--workspace-concurrency=1`) and the test-time `lib/db` pool cap (`max` 5 under
  `VITEST`). Neither changes product runtime behaviour: the server pool default of 20 is unchanged and
  the serialization affects only how the test gate is driven. Logged so a future reader knows the suite
  is intentionally serialized across packages.
- The upload contract path (pdf and docx) derives metrics through the in-boundary extraction seat; the
  upload test exercises that seat without spending a live frontier model, and where the seat is not
  configured the established "available, not connected" honesty applies rather than a fabricated metric.
- Stage 4 still-live item carried forward unchanged: a tenant case study is recomputed per public
  cold-link hit rather than cached (AB). Unrelated to ingestion; carried in the rollup, not addressed here.

## Remediation iterations

The architect's first `evaluate_task` review of this phase returned FAIL with four boundary-hardening
items at the derive-and-discard seam, not a clean first pass. All four were applied and the gate re-run
green before the PASS recorded below:

- Ingestion metadata guard. The shared core now rejects identifying free text in any signal's `key`,
  `window`, or `unit` at the single terminus (a short non-identifying metric token only), mapped to a
  precise 400 rather than a 500. The first-party connector contract schema stays permissive; the stricter
  check lives where untrusted external input arrives.
- Generic positional upload keys. Spreadsheet signal keys are now `column_<n>` (1-based), so a raw header
  label can never land in a stored signal key; the human header survives only in the transient HTTP
  derived-versus-discarded summary and is never persisted.
- SFTP rejected-file discard. A rejected raw file left on disk is itself a raw-artifact leak, so the
  watcher now DELETES a rejected file (with a loud logged reason) instead of renaming it to a ".rejected"
  copy, and its directory listing no longer needs a ".rejected" skip clause.
- Strengthened raw-absence test. The sentinel is placed in each path's numeric raw position, the webhook
  delivery path is exercised end to end (HMAC-signed acceptance and raw-body rejection), the API
  identifying-metadata case asserts a 400, and the SFTP bad-file case asserts the file is deleted (the
  rejected count rises and both files are gone), all before the schema-wide sentinel sweep.

After these four, typecheck and build re-ran green, the full suite re-ran green at 794, and both
long-dash sweeps (source guard and the database-wide cast) reported zero.

## Gate

Phase AE passed its architect `evaluate_task` review (PASS). The drift index, the rollup, and the V2
build report are updated to "A through AE". Phase AE is the ingestion stage of Stage 5 (Platform
completion). Per the owner-authorized AE-through-AI Stage 5 sequence this phase does NOT pause at its own
gate; execution continues to Phase AF (local LLM seat and sovereign mode). The next protocol milestone
hard stop is Phase AI at the end of Stage 5. The known AF blocker stands: AF acceptance needs a real
local OpenAI-compatible model endpoint, which this container does not provide; if none is available at
the AF gate, `docs/drift/STOP.md` is written and the build pauses there.
