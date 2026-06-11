# MASTER BUILD PROMPT · V2 OPERATIONS AND HARDENING
## Different Day · Elevated Intelligence · The Run-It-In-Production Pass

This is the third build prompt, after the V2 Master Build Prompt and the Data Connectors and SOC 2 addendum. Those two cover what to build. This one covers what happens when it is running and what a client security review or an acquirer will ask for. Read both prior prompts first. Everything there still holds: the gated phases, the regression contract, the three-model cortex, the derive-and-discard principle, and the em-dash ban. Never use a long em-dash anywhere, in code, copy, seed data, schema comments, or your own status messages. Use a comma, colon, or full stop.

These phases continue from Phase M. Execute them gated, one at a time, stopping for confirmation after each.

---

## 1 · COST AND TOKEN OBSERVABILITY (Phase N)

The system runs three models across roughly nine sub-stages per layer, fourteen layers per seed, plus web search. Spend runs away silently. You already have the data: the model wrappers return `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, and `searchCallCount` on every call result. Capture it.

- **Persist usage.** Add a `model_usage` table: `id uuid pk`, `tenantId uuid`, `runId uuid`, `stage text`, `layerKey text`, `model text`, `inputTokens int`, `outputTokens int`, `cacheReadTokens int`, `cacheCreationTokens int`, `webSearchCalls int`, `costUsd numeric(12,6)`, `createdAt`. Write one row per model call from the pipeline, tapping the existing `CallResult` fields. Do this for both the Anthropic and the Gemini wrappers.
- **One pricing table.** Put per-model input, output, cache, and web-search rates in a single config object (`cortex.ts` or a new `pricing.ts`), the only place rates live. Compute `costUsd` at write time so historical rows stay correct even if rates change later.
- **Owner cost view.** Add an owner-only Spend screen: total spend over time, broken down by tenant, by model seat (Cortex Lens, Evaluator, Confounder plus Challenger), by stage, and per seed run. Show cost per seeded tenant so the unit economics of a diagnosis are visible.
- **Budget guardrails.** A configurable per-tenant monthly cap and a global cap. Alert (per Phase P) at a threshold, for example 80 percent, and refuse to start a new non-priority seed when the global cap is exceeded, returning a clear error rather than spending silently. The express seed mode from the master prompt is the fallback when budget is tight.

Acceptance: every model call produces a usage row with a non-null `costUsd`, the Spend screen reconciles against a manual sum, and a tenant that exceeds its cap is blocked with a clear message.

---

## 2 · CONNECTOR OPERATIONAL REALITY (Phase O)

The connectors addendum designed the clean extraction path. Production is the unhappy path. Build it.

- **OAuth token refresh.** Tokens expire. Add a refresh scheduler that renews a connection's token before expiry without a human in the loop. If refresh fails, set the connection `status` to `error`, surface "re-authentication required" in the Connections screen, and alert. Never let a silently expired token degrade a diagnosis.
- **Client API rate limits.** Salesforce, HubSpot, the ad platforms, and the warehouses throttle hard. Each connector declares its quota profile in the registry. The connector runtime enforces a token-bucket limiter per connection, respects `Retry-After` headers, and uses exponential backoff for throttling that is distinct from genuine errors, mirroring the 429 handling already in the seed pipeline.
- **Connector health.** Track `lastSuccessAt` and a staleness threshold per connection. Derive a health state of healthy, degraded, or error, and surface it in both the Connections screen and the Security posture view. Alert on any transition to error.
- **Incremental extraction where the source supports it.** Use a cursor or watermark so a refresh re-derives only what changed, cutting cost and load. This must respect the ephemeral rule: persist only the watermark, never the source data behind it. Fall back to a full derive where the source has no cursor.

Acceptance: a connection with an expiring token refreshes on its own, a throttled source backs off and recovers without failing the run, and a dead connection shows as error and fires an alert.

---

## 3 · OBSERVABILITY AND ALERTING (Phase P)

A multi-minute background seed that dies at 2am is invisible today. The pino logger exists but nothing aggregates errors and nothing notifies anyone.

- **Error aggregation.** Wire an error aggregation service (Sentry or equivalent). This is an authorised new dependency. Capture pipeline failures, connector failures, and unhandled route errors with enough context to debug, but never with raw client data or secrets in the payload.
- **A notification sink.** One pluggable notifier (email, Slack webhook, or generic webhook, configured by env) that fires on: seed run failure, connector transition to error, budget threshold breach, break-glass grant used, and provenance chain integrity failure. Keep the messages free of sensitive content.
- **Run and job visibility.** An owner Operations screen: in-flight runs, recent failures with their failing stage, and live seed-queue depth (the seed limiter already tracks running and waiting counts, surface them).
- **Real health checks.** Expand the existing health route into a dependency check: database reachable, both model providers reachable, secret store reachable. Return a structured status so an uptime monitor can watch it.

Acceptance: a deliberately failed seed appears in the Operations screen and fires one notification, and the health route reports per-dependency status.

---

## 4 · SECRETS VAULT (Phase Q)

The connectors addendum says `authRef` and `kmsKeyRef` point into a vault, but no vault exists yet. Wire a real one. Nothing sensitive may sit in Postgres or in the git-tracked `.replit`.

- **One interface.** Define a `SecretStore` interface with get, set, and delete by reference. Back it in production with a managed secret manager. Default to GCP Secret Manager, which fits the GCP-portable target, with a local-dev fallback backed by env so the app still runs on a laptop.
- **Resolve everything through it.** Connector credentials (`tenant_connections.authRef`), per-tenant key references (`tenant_keys.kmsKeyRef`), and ideally the owner and session secrets all resolve through the `SecretStore`. The database stores only references, never the secret value.
- **Migration note.** Move `OWNER_PASSWORD` and any connector credentials behind the store. Document the change in `replit.md` and keep the lazy throw-if-missing pattern so a misconfiguration surfaces as a clear error on first use, not a boot crash.

Acceptance: no secret value appears in any table or in `.replit`, and a connection authenticates by resolving its `authRef` through the store.

---

## 5 · AUTOMATED TESTS AND CI (Phase R)

There are zero tests and no CI today. Every verification step in the prior prompts is manual. For software that touches client data this is the gap a client security review or an acquirer finds in the first hour. Add a test runner (Vitest, an authorised dependency) and cover the load-bearing invariants, not everything.

Tests that must exist and pass:

- The `DerivedSignalSet` schema guard rejects a connector that returns raw records.
- The extraction path has no database handle and no filesystem write capability.
- PIN validation: a wrong, expired, revoked, and used-up PIN each fail with the same generic error, and a valid PIN succeeds and decrements availability exactly once.
- `requireOwner` returns 403 for a member and passes for an owner.
- Session cookie: a valid token verifies, a tampered token is rejected, an expired token is rejected.
- The provenance ledger is append-only and a broken hash chain is detected.
- Prompt hygiene: a guard test scans `prompts.ts` and `phase2-prompts.ts` and fails if a literal example figure (a bare bps value, a margin percentage, a dollar amount) appears, since that is the bug that makes every tenant come out with identical numbers.
- Em-dash guard: a test scans `artifacts/portal/src/data/**` and the narrator and hero copy and fails on any long em-dash.

CI: add a GitHub Actions workflow (the repo is already on GitHub) that runs typecheck, build, and the test suite on every pull request, and blocks merge on failure.

Acceptance: the suite runs green locally and in CI, and deliberately breaking any one invariant turns its test red.

---

## 6 · RETENTION AND DELETION (Phase S)

The connectors brief nailed raw-data discard and crypto-shredding. Derived signals still persist, and nothing yet says for how long or how to honour an erasure request against them.

- **Retention policy.** A configurable TTL on `derived_signals`, default 90 days, after which a scheduled purge job removes signals that have not been refreshed. Refresh resets the clock. Document the default in `replit.md`.
- **Erasure path.** A tenant-scoped delete that removes that tenant's derived signals and, where identity threads exist, a token-scoped delete within a tenant. Because the provenance ledger is append-only and tamper-evident, you do not delete its rows: you append a redaction record that marks the referenced entries as erased while preserving chain integrity. This complements key revocation, which crypto-shreds, by handling the derived layer cleanly.
- **Evidence.** Every purge and every erasure is logged with what, when, and on whose authority, so the deletion story is evidenceable for the audit.

Acceptance: a signal past its TTL is purged on schedule, an erasure request removes a tenant's derived signals and appends a ledger redaction without breaking the chain, and both actions are logged.

---

## 7 · CLIENT-SIDE USER ACCESS (Phase T)

The PIN model from the master prompt is for Different Day staff, owner and member, flat. A paying connected engagement implies client users who see only their own tenant. Extend the model.

- **Org concept.** Add `orgs`: Different Day is the single provider org, each client engagement is a client org bound to one or more tenants. Add `orgId` to users and a binding from client orgs to their tenants.
- **Roles.** Provider-owner, provider-member, client-admin, client-viewer. Provider-owner keeps everything including Spend and the admin consoles. Client users see only their own org's tenant or tenants, and never the Spend screen, never other tenants, never the connector credentials.
- **Scoped PINs.** Extend PIN minting so the owner can mint a PIN scoped to a specific org and role. A client-admin PIN onboards a client user into their org only. A client-admin can then mint client-viewer PINs within their own org, but cannot reach anything provider-side.
- **No standing access still applies.** The break-glass rule from the connectors addendum is unchanged: no human, provider or client, has standing access to connected-tenant raw signals. Client users see their diagnosis and provenance, which is derived output, not raw records.

A decision is embedded here and the recommended default is: client-viewer sees the diagnosis, the reasoning chain, and the provenance, but not cost data, not connector internals, and not other tenants. Confirm or change that default before building.

Acceptance: a client-viewer signed into their org sees only their tenant, gets 403 on any provider route and any other tenant, and a client-admin can onboard a viewer into their own org and no further.

---

## 8 · BACKUPS AND DISASTER RECOVERY (Phase U)

The derived signals and the provenance ledger are both the crown jewels and the audit evidence. There is no backup or restore story today.

- **Database backups.** Enable automated Postgres backups with point-in-time recovery and a defined retention window. The crown-jewel tables are `derived_signals`, `provenance_ledger`, `users`, `invite_pins`, and `tenant_keys` (references only). Document an RPO and RTO target.
- **Ledger archive.** Export the append-only provenance ledger to durable object storage on a schedule, write-once where the storage supports it, so it doubles as a tamper-evidence archive and survives a database loss.
- **Tested restore.** A documented restore runbook, and a one-time proven restore into a scratch environment so the backups are known to actually work, not assumed to.

Acceptance: backups run on schedule, a restore into a scratch environment succeeds, and the ledger archive contains a verifiable copy of the chain.

---

## 9 · VERIFICATION (Phase V)

1. `pnpm run typecheck`, `pnpm run build`, and the new test suite all pass, in CI.
2. Cost rows exist for every model call and the Spend screen reconciles.
3. A capped tenant is blocked with a clear message.
4. A connector recovers from token expiry and from throttling without failing the run, and a dead connector alerts.
5. A failed seed appears in the Operations screen and fires exactly one notification.
6. No secret value sits in any table or in `.replit`.
7. Every load-bearing invariant in Phase R has a test, and breaking it turns the test red.
8. A TTL purge and an erasure both run and log, and the erasure preserves ledger chain integrity.
9. A client-viewer is correctly fenced to their own tenant.
10. A restore from backup succeeds in a scratch environment.
11. Em-dash sweep returns zero hits in user-facing prose and data.
12. Append to `docs/build-report-v2.md`: the new tables and routes, the secret store choice, the test and CI setup, the retention defaults, the org and role model, and the backup and DR targets.

---

## EXECUTION ORDER (gates, continuing from the connectors addendum)

- **Phase N.** Cost and token observability.
- **Phase O.** Connector operational reality.
- **Phase P.** Observability and alerting.
- **Phase Q.** Secrets vault.
- **Phase R.** Automated tests and CI.
- **Phase S.** Retention and deletion.
- **Phase T.** Client-side user access.
- **Phase U.** Backups and disaster recovery.
- **Phase V.** Full verification and the build-report append.

Begin with Phase N. Do not proceed past any gate without my explicit confirmation.
