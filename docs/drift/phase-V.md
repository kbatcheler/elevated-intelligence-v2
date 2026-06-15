# Phase V: verification and the build-report append (closes Stage 3)

Phase id: V. Name: Verification and the build-report append. Milestone: no (gated; the closing
phase of Stage 3, Operations and Hardening, run back to back with U and W under owner
authorization). This phase built no product feature and changed no product code; like Phase M
closed Stage 2, its only artifacts are this evidence matrix, the build-report append, and the
drift updates. It added zero npm dependencies and contains no em-dash or en-dash in source or in
data.

Approach: each of the twelve points in section 9 of the Operations and Hardening prompt is
mapped to the EXISTING evidence built and tested across Phases N through U, with the proof type
marked honestly (proven by the integration suite against live Postgres, proven live in an
earlier phase, or an operator-level responsibility documented but not application-run). The
global gates (typecheck, build, the full test suite, the source dash guard, the database-wide
dash sweep) were re-run fresh for this phase and the totals below are from that run.

## The section 9 evidence matrix

1. Typecheck, build, and the test suite all pass, in CI. MET (integration; hosted CI is a
   standing logged drift). Fresh run: typecheck green across all workspace projects, build green
   (portal 1742 modules, api-server bundled), full suite green at 557 tests. CI is defined in
   `.github/workflows/ci.yml` (Phase R) as separate required typecheck, build, and test steps
   that block the merge on any nonzero exit; the hosted runner cannot execute inside this
   environment, so the same steps run locally and pass, which is the same evidence the hosted job
   would produce (recurring environmental drift since Phase B).

2. Cost rows exist for every model call and the Spend screen reconciles. MET (integration, not a
   fresh live model seed). The `model_usage` ledger is written one row per REAL billed model
   call by the orchestrator; `lib/cortex/src/pricing.ts` is the only place tokens become dollars
   (`pricing.test.ts`). The Spend route and its reconciliation to a direct SUM are proven by
   `routes/spend.integration.test.ts`, the governor and the budget math by
   `lib/pipeline/budget.integration.test.ts` and `lib/pipeline/budget.test.ts`, and the portal
   Spend surface by `lib/spendApi.test.ts`. The live token-billed rows themselves were produced
   by the live cortex seeds in Phases C and F; this phase did not re-run a paid seed.

3. A capped tenant is blocked with a clear message. MET (integration). The budget governor reads
   the real summed ledger spend and refuses a new seed or refresh at a ceiling with a typed HTTP
   error; `lib/pipeline/budget.integration.test.ts` proves the block, and `budget.test.ts`
   proves the governor decision (global and per-tenant caps, the owner priority override of the
   global ceiling only).

4. A connector recovers from token expiry and from throttling without failing the run, and a
   dead connector alerts. MET (integration; OAuth via an injected seam, no live provider token
   exchange). Throttle recovery (retry only a typed throttle signal, honor Retry-After else
   backoff, never retry a genuine error) is proven by `lib/connectors/rateLimiter.test.ts`;
   token-expiry renewal and the failure-to-error transition with the critical alert are proven by
   `lib/connectors/oauthRefresh.integration.test.ts` against an injected refresher (there is no
   oauth2 connector runtime, so the default refresher rejects honestly as available-not-connected
   and the failed-renewal path is the fully real part); read-time connector health (a never-run
   or stale connection reads degraded, an errored one alerts on the transition) is proven by
   `lib/connectors/connectionHealth.test.ts`, and the end-to-end refresh path by
   `lib/connectors/connectedRefresh.integration.test.ts`.

5. A failed seed appears in the Operations screen and fires exactly one notification. MET
   (integration; external sinks available-not-connected unless env is set). The Operations
   surface reads real run, queue, and alert tables (`routes/operations.integration.test.ts`); the
   notifier drains pending `alert_events` with FOR UPDATE SKIP LOCKED so a row is delivered
   exactly once and dedupes a budget threshold per scope per month
   (`lib/alerts/notifier.integration.test.ts`). With no Slack or webhook env the notifier
   delivers to the honest log sink and with no SENTRY_DSN the reporter is a no-op
   (`lib/observability/sentryReporter.test.ts`); it never fabricates an alert.

6. No secret value sits in any table or in `.replit`. MET (integration plus a fresh sweep; the
   GCP backend is not connected). `lib/secrets/secretResolution.integration.test.ts` resolves a
   unique sentinel through an injected store during a real refresh and sweeps every public text
   and jsonb column plus the repo-root `.replit` for it, asserting zero. The default env-backed
   store resolves by reference (an env var name), and only references and one-way hashes are
   persisted; the durable write path (the GCP Secret Manager adapter) is available-not-connected
   here.

7. Every load-bearing invariant in Phase R has a test, and breaking it turns the test red. MET
   (integration; tests were not weakened or broken to verify this phase). The Phase R invariant
   set holds: the DerivedSignalSet guard (`lib/db/.../derivedSignalSet.test.ts`,
   `lib/connectors/guardedExtractSignals.test.ts`), the connector and edge-agent no-db-handle
   no-`node:fs` import boundary (`lib/connectors/importBoundary.test.ts`,
   `artifacts/edge-agent/src/importBoundary.test.ts`), the four PIN failure modes and owner
   gating (`lib/auth/pin.test.ts`, `lib/auth/access.test.ts`), the session cookie
   (`lib/auth/session.test.ts`), the append-only ledger with broken-chain detection
   (`lib/provenance/ledger.test.ts`), the long-dash guard (`scripts/emDashGuard.test.ts`), and
   prompt hygiene (`lib/cortex/src/prompts/promptHygiene.test.ts`). Each was demonstrated to bite
   on a tampered or synthetic input in its own phase; this phase did not re-break them.

8. A TTL purge and an erasure both run and log, and the erasure preserves ledger chain
   integrity. MET (integration). `lib/retention/retention.integration.test.ts` proves the TTL
   purge deletes aged signals and writes one `ttl_purge` audit row per affected tenant (and none
   on an empty tick), and that an erasure deletes a tenant's signals, appends a
   `redaction:derived_signals:tenant` provenance entry with a `sha256:` digest in the same
   transaction, writes a `tenant_erasure` audit row, and leaves `verifyChain` passing;
   `routes/retention.integration.test.ts` proves the owner-only routes and the typed refusal of a
   token-scoped erasure.

9. A client-viewer is correctly fenced to their own tenant. MET (integration). The fencing is
   proven by `routes/client.integration.test.ts` (scope-forced mint, list, and revoke; widening
   rejected), `routes/tenants.integration.test.ts` (a client-viewer 403 on both action mutation
   routes, on a tenant it can read, so it is the role gate not tenant fencing),
   `routes/security.integration.test.ts` (a non-provider role refused the break-glass raw-signal
   read), and the portal `lib/clientApi.test.ts`.

10. A restore from backup succeeds in a scratch environment. MET (integration scratch-schema
    proof; full PITR-to-new-instance is operator-level documented, not application-run).
    `lib/backups/crownJewels.integration.test.ts` and `runRestoreDrill` export the crown jewels,
    restore them into an isolated `scratch_restore_*` schema, verify the per-table counts, and
    re-walk the restored ledger chain from the restored scratch rows; `routes/backups.integration.test.ts`
    round-trips a ledger archive and re-verifies its digest and chain. A full restore to a
    separate database instance is the operator's platform-level procedure in
    `docs/backup-and-dr-runbook.md`.

11. Em-dash sweep returns zero hits in user-facing prose and data. MET (freshly re-run, both
    sides). The source guard (`scripts/emDashGuard.test.ts`) is green over authored source, and a
    fresh database-wide cast over every public text and jsonb column (107 columns, including
    `backup_events`) reports `TOTAL DASH HITS 0`.

12. Append to `docs/build-report-v2.md`. MET. The consolidated Phase V section records the Stage
    3 tables and routes, the secret-store choice, the test and CI setup, the retention defaults,
    the org and role model, and the backup and DR targets.

## Honest integration-versus-live marking

Most operational invariants are proven by the integration suite running the real application
against live Postgres, not by a fresh production incident: the capped-tenant block, the
notification-exactly-once drain, the retention purge and erasure, the client-viewer fencing, and
the restore drill all execute real code against the real database. Three boundaries are honestly
not "live" here and are marked as such: live paid model seeds happened in Phases C and F and were
not re-run this phase (so the cost-row evidence is the ledger and its tests, not a new paid run);
the OAuth token-refresh path is proven against an injected refresher because there is no oauth2
connector runtime (the failure path is fully real, the live provider token exchange is not); and
the external alert sinks (Slack, generic webhook, Sentry) and the durable secret and archive
backends (GCP Secret Manager, GCS) are available-not-connected unless their env is configured, so
they are verified as honest adapters rather than live deliveries. A full PITR restore to a
separate instance is an operator-level platform procedure, documented but not application-run.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 557 tests (api-server 258 across 32 files, portal 164, cortex 84,
  connectors 29, edge-agent 10, db 8, scripts 4). This phase added no tests and changed no
  product code.
- Long-dash sweep zero on both sides: the source guard is green, and a fresh database-wide cast
  over all 107 public text and jsonb columns reports zero hits.
- Zero new npm dependencies.

## Logged drift and deviations

- Phase V is verification and documentation only; it built no product code, matching how Phase M
  closed Stage 2. Where re-running a check would have been destructive or paid (breaking an
  invariant test on purpose, running a fresh paid model seed), the existing in-phase evidence is
  cited instead and the proof type is marked.
- Hosted CI cannot execute in this environment; the CI workflow's steps run locally and pass
  (recurring environmental drift since Phase B).
- The restore evidence is a scratch-schema drill, the strongest restore proof the application can
  make on its own; the full PITR-to-new-instance drill is the operator's documented platform
  procedure (carried forward from Phase U).

## Gate

Phase V passed its architect `evaluate_task` review (PASS). The drift index, the rollup, and the
V2 build report are updated to "A through V". Per the owner-authorized U-V-W run this does not
pause; it proceeds to Phase W, which opens Stage 4. The hard stop is after Phase W, before
milestone X.
