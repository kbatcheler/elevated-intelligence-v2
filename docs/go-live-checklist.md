# Go-live checklist

The actionable, tick-box version of the production deploy facts. Each box is one
operator action to confirm before the first production boot, or before promoting a
new environment. The rationale behind every item lives in
`docs/deploy-readiness.md` and `docs/migration-runbook.md`; this file is the list
you work down, not the explanation.

Nothing here is optional unless it says so. An unchecked box is a known gap, not a
detail to fill in later.

## 1. Secrets are present before first boot

- [ ] `OWNER_EMAIL` is set in the deployment environment (in the clear; it is not
      a secret).
- [ ] `OWNER_PASSWORD` is set and resolves through the SecretStore
      (`SECRET_STORE_PROVIDER` and its backend are configured). Only the scrypt
      hash is ever persisted; the plaintext is never stored.
- [ ] `SESSION_SECRET` is set and resolves through the SecretStore.
- [ ] `DATABASE_URL` is set (read directly by the pg driver, injected as a secret
      env, not fetched through the store).

## 2. SESSION_SECRET is stable

`SESSION_SECRET` signs every session cookie and peppers every invite-PIN code
hash, so rotating it forces every user to log in again and invalidates every
outstanding invite PIN.

- [ ] The production `SESSION_SECRET` is generated once and pinned; it is not
      regenerated on each deploy.
- [ ] If a rotation is ever required (a suspected leak), a forced re-login and a
      re-mint of any live invite PINs are planned for the same window.

## 3. Owner bootstrap

`ensureProviderOrgAndOwner()` runs at startup and needs `OWNER_EMAIL`,
`OWNER_PASSWORD`, and `SESSION_SECRET` present at boot. If any is missing the
server logs and continues without creating an owner, leaving no one able to mint
PINs.

- [ ] All three are confirmed present in the production environment before first
      boot.
- [ ] After first boot, the owner row exists (the owner can log in).

## 4. Schema and canonical data

- [ ] The Drizzle schema is pushed to the production database
      (`pnpm --filter @workspace/db push`).
- [ ] The canonical layer registry is seeded
      (`pnpm --filter @workspace/db seed:layers`).

## 5. Provenance ledger append-only DB role (REQUIRED)

The provenance ledger is append-only in the application; the database role is the
second line of defence. This step is required, not optional.

- [ ] `infra/sql/provenance-ledger-append-only.sql` has been run once for this
      environment, as a privileged role, against the least-privilege runtime role:
      `psql "$ADMIN_DATABASE_URL" -v app_role=YOUR_RUNTIME_ROLE -f infra/sql/provenance-ledger-append-only.sql`.
- [ ] The script completed without raising. It is fail-loud: under
      `ON_ERROR_STOP` it aborts if the runtime role can still UPDATE, DELETE, or
      TRUNCATE the ledger through any path, or is missing SELECT or INSERT.
- [ ] The printed runtime-role grants show only SELECT and INSERT.

## 6. Rate-limit store and scaling posture

- [ ] `RATE_LIMIT_STORE=postgres` is set for the deployed target so both
      rate-limit stores (the auth fixed window and the connector token bucket)
      use the shared Postgres tables. The provided GCP Terraform sets this.
- [ ] The deployed target runs a single always-on instance. The seven in-process
      scheduled loops (connector maintenance, alert notifier, retention purge,
      backup archive, benchmark recompute, push morning brief, sftp drop watcher)
      have no cross-instance coordination and run once per instance, so in steady
      state exactly one instance is the loop runner. The provided GCP Terraform
      pins `min_instance_count = 1` and `max_instance_count = 1`. (A revision
      rollout briefly overlaps two revisions, a bounded window of possible
      duplicate ticks; see `docs/deploy-readiness.md`.)
- [ ] If the request tier must scale past one instance, a separate single
      loop-runner instance or per-loop leader election is in place first (this is
      not the shipped default).
- [ ] The boot logs show the expected posture: rate-limit store `postgres` (no
      in-memory warning) and the single loop-runner statement.

## 7. Backups and disaster recovery

- [ ] Managed point-in-time recovery is enabled on the database (the GCP
      Terraform turns it on for Cloud SQL).
- [ ] The archive store is configured if used (`ARCHIVE_STORE_PROVIDER=gcs` and
      `GCS_ARCHIVE_BUCKET`, or the S3 equivalent).
- [ ] The owner-only restore drill has been run at least once and verified row
      counts and re-walked every tenant chain. See
      `docs/backup-and-dr-runbook.md`.

## 8. Smoke test

- [ ] `GET /health` returns 200 with `database` and `secretStore` reachable.
- [ ] The owner can sign in.
- [ ] The portal loads at `/`.

## 9. Rollback readiness

- [ ] The previous known-good image revision is retained for an instant,
      traffic-based rollback.
- [ ] The database point-in-time-recovery rollback path is understood (restore to
      a timestamp, repoint `DATABASE_URL`, redeploy). The provenance ledger is
      re-verified on restore, so a chain-breaking restore is surfaced. See
      `docs/migration-runbook.md`.
