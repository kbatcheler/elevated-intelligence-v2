# Migration runbook: porting Elevated Intelligence V2 to GCP or AWS

This runbook is executable, not aspirational. It describes the production image,
the two cloud targets and their exact environment mapping, the database
migration path, the cutover sequence, and the rollback. The GCP target ships
with a minimal but real Terraform definition in `infra/gcp/` so the architecture
below is the architecture the code stands up.

## Honesty boundary

The platform owner runs the parts that need a Docker host and a cloud account;
this repository builds and proves everything it can without one.

- Proven in this repository, by the test suite run through the workflows: the
  Postgres-backed queue holds the global concurrency cap across two simultaneous
  instances; the SecretStore selects the env, GCP, or AWS backend and stays
  available-not-connected until configured; the archive store selects the local,
  GCS, or S3 backend the same way; the AWS SigV4 signer reproduces the published
  AWS golden signature; the api-server serves the built portal SPA at "/" while
  never shadowing an API path.
- Run by the owner on a Docker host (not runnable in this repository, which has
  no Docker daemon): `docker build`, `docker compose up`, and the full demo seed
  inside the container. The commands are given below and in `docker-compose.yml`;
  the result is recorded in the phase drift report once the owner runs it.
- Owned by the cloud platform, not this application: durable Postgres storage and
  point-in-time recovery. This runbook documents the targets (RPO and RTO) and
  the operator responsibility; it does not reimplement managed-database
  durability. This is the same boundary the SecretStore draws around durable
  secret storage.

## The production image

`Dockerfile` builds one image (`.dockerignore` keeps the build context lean):

- A multi-stage pnpm build on `node:22-bookworm-slim` (the Node major matches the
  esbuild `node22` target). The build stage installs the frozen lockfile and runs
  `pnpm run build`, producing the portal build (`artifacts/portal/dist/public`)
  and the api-server bundle (`artifacts/api-server/dist/index.mjs`).
- The runtime stage carries the built workspace and runs the api-server, which
  serves the portal SPA at "/" because the image sets `PORTAL_DIST_DIR`. The same
  image also carries the migration tooling (`drizzle-kit`) and the seed scripts
  (`tsx`), so one artifact runs the app, pushes the schema, and seeds a demo.
- Twelve-factor: no secret is baked into the image. Every secret and endpoint is
  read from the environment and resolved through the SecretStore at first use.

Build and run locally (the portability proof on a laptop):

```
docker build -t elevated-intelligence:local .
docker compose up --build
# migrate runs first, then the app serves on http://localhost:8080
docker compose --profile seed run --rm seed   # optional full demo seed
```

A complete demo seed exercises the model pipeline, so it needs the provider keys
(`AI_INTEGRATIONS_ANTHROPIC_*`, `AI_INTEGRATIONS_GEMINI_*`) in the environment.
Without them the connector and ingestion seeds still run.

## Target architecture: GCP (primary)

Cloud Run runs the single-container app, Cloud SQL is Postgres, Secret Manager
holds the secrets, and a Cloud Storage bucket holds the provenance ledger
archives. `infra/gcp/` defines all of it.

| Concern        | GCP service        | How the app uses it                                                  |
| -------------- | ------------------ | ------------------------------------------------------------------- |
| Compute        | Cloud Run          | Runs the image; injects PORT; the app serves API and portal at "/". |
| Database       | Cloud SQL Postgres | DATABASE_URL over the /cloudsql Unix socket mounted by Cloud Run.    |
| Secrets        | Secret Manager     | SECRET_STORE_PROVIDER=gcp resolves SESSION_SECRET and OWNER_PASSWORD. |
| Object storage | Cloud Storage      | ARCHIVE_STORE_PROVIDER=gcs, GCS_ARCHIVE_BUCKET holds ledger archives. |

Environment on Cloud Run (set by the Terraform):

- `SECRET_STORE_PROVIDER=gcp` and `GCP_PROJECT_ID` so the app resolves
  `SESSION_SECRET` and `OWNER_PASSWORD` through Secret Manager using the runtime
  service account's metadata token.
- `ARCHIVE_STORE_PROVIDER=gcs` and `GCS_ARCHIVE_BUCKET` so ledger archives land
  in the bucket; the GCS adapter uses the same metadata token.
- `OWNER_EMAIL` in the clear (not a secret), `DATABASE_URL` injected as a secret
  env (the pg driver reads it from the environment, not through the store).
- `PORT` is injected by Cloud Run; `PORTAL_DIST_DIR` is already set in the image.
- `RATE_LIMIT_STORE=postgres` so both rate-limit stores use the shared Postgres
  tables, which holds the limit across the brief two-revision overlap during a
  rollout and readies a future multi-instance request tier.

Scaling posture: the target pins a single always-on instance
(`min_instance_count = 1`, `max_instance_count = 1`). That instance is the single
runner for the seven in-process scheduled loops (connector maintenance, alert
notifier, retention purge, backup archive, benchmark recompute, push morning
brief, sftp drop watcher), which have no cross-instance coordination and run only
while an instance is alive. Scaling the request tier past one instance is a
deliberate future posture that needs a separate single loop-runner instance or
per-loop leader election; see `docs/deploy-readiness.md` and
`docs/go-live-checklist.md`.

The service is reachable by default: the Terraform grants `roles/run.invoker` to
`allUsers`, so the Cloud Run URL answers browsers and the `GET /health` smoke test
in the cutover below. This is platform-level invocation only; the application still
enforces its own authorization at the application layer (session-gated tenant and
admin routes, and intentionally public or key, token, and HMAC gated health,
static, public-share, webhook, and MCP routes), so the public invoker grant
exposes no tenant data. To make the service private at the
edge instead, apply with `-var allow_unauthenticated=false` and front it with IAP
or an authenticated load balancer that holds the invoker grant.

Apply it:

```
cd infra/gcp
terraform init
terraform apply \
  -var project_id=YOUR_PROJECT \
  -var image=REGION-docker.pkg.dev/YOUR_PROJECT/REPO/elevated-intelligence:TAG \
  -var owner_email=owner@yourco.com \
  -var owner_password=... \
  -var session_secret=... \
  -var db_password=...
```

Push the image first to Artifact Registry, then pass its full reference as
`image`. The outputs give the service URL, the Cloud SQL connection name, and the
archive bucket.

## Target architecture: AWS (equivalent)

The same image runs unchanged; only the managed services and the environment
differ.

| Concern        | AWS service                 | How the app uses it                                            |
| -------------- | --------------------------- | ------------------------------------------------------------- |
| Compute        | App Runner or ECS Fargate   | Runs the image; the app serves API and portal at "/".         |
| Database       | RDS for PostgreSQL          | DATABASE_URL points at the RDS endpoint over TLS.             |
| Secrets        | AWS Secrets Manager         | SECRET_STORE_PROVIDER=aws resolves SESSION_SECRET and OWNER_PASSWORD. |
| Object storage | S3                          | ARCHIVE_STORE_PROVIDER=s3, S3_ARCHIVE_BUCKET holds archives.   |

Environment on AWS:

- `SECRET_STORE_PROVIDER=aws` and `AWS_SECRETS_MANAGER_REGION` (or `AWS_REGION`)
  so the app resolves `SESSION_SECRET` and `OWNER_PASSWORD` through Secrets
  Manager. Credentials come from the task or instance role; on a non-AWS host set
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally
  `AWS_SESSION_TOKEN`.
- `ARCHIVE_STORE_PROVIDER=s3`, `S3_ARCHIVE_BUCKET`, and `S3_ARCHIVE_REGION` (or
  `AWS_REGION`) so ledger archives land in the bucket.
- `OWNER_EMAIL` in the clear; `DATABASE_URL` injected from Secrets Manager (the
  pg driver reads it from the environment).

Both SecretStore and archive-store adapters are zero-SDK HTTP over the Node
global fetch and are available-not-connected until their region or bucket is set,
so a misconfiguration fails loudly and lazily on first use rather than at boot.

## Database migration path

The schema is Drizzle-managed; the data path is standard Postgres logical
backup and restore.

1. Schema. The app schema is pushed with Drizzle, not hand-written SQL:
   `pnpm --filter @workspace/db push` (add `push-force` to accept a destructive
   diff on a re-push). On GCP, run it from a workstation through the Cloud SQL
   Auth Proxy, or as a one-off Cloud Run Job using the same image and the
   `["pnpm","--filter","@workspace/db","push"]` command. On AWS, run it against
   the RDS endpoint.
2. Canonical layer seed. `pnpm --filter @workspace/db seed:layers` admits the
   canonical layer registry.
3. Data, when migrating an existing instance. Use a logical dump and restore:
   `pg_dump --no-owner --format=custom SOURCE_URL > dump.pgc` then
   `pg_restore --no-owner --dbname=TARGET_URL dump.pgc`. The provenance ledger is
   hash-chained; after restore, the owner-only backup verify path re-walks every
   tenant chain, so a corrupted or partial restore is detected, not trusted.
4. RPO and RTO. With managed point-in-time recovery enabled (the Terraform turns
   it on for Cloud SQL), the recovery point objective is the platform's
   continuous-archiving granularity (seconds to a few minutes) and the recovery
   time objective is the time to provision a restored instance plus redeploy the
   stateless app. See `docs/backup-and-dr-runbook.md` for the application-side
   crown-jewel logical backup and the proven scratch-restore drill.
5. Append-only hardening (REQUIRED, not optional). After the schema is pushed,
   remove UPDATE and DELETE on `provenance_ledger` from the runtime role so the
   append-only contract is enforced at the database layer as well as in the
   application. The script is fail-loud: under `ON_ERROR_STOP` it aborts if the
   runtime role can still UPDATE, DELETE, or TRUNCATE the ledger through any path,
   or is missing SELECT or INSERT, so a partial hardening can never look complete.
   Run it once per environment:
   `psql "$ADMIN_DATABASE_URL" -v app_role=YOUR_RUNTIME_ROLE -f infra/sql/provenance-ledger-append-only.sql`.
   Run it as a privileged role; it is idempotent and prints the runtime role's
   remaining grants (expect only SELECT and INSERT). See
   `docs/deploy-readiness.md` for the rationale (a role grant, not a block
   trigger, so the privileged tenant-deletion cascade stays intact).

## Cutover sequence

1. Provision the target infrastructure (`terraform apply` for GCP; the
   equivalent for AWS). This creates the database, the bucket, the secrets, and
   the service identity, but the service has no data yet.
2. Push the schema and seed the canonical layers (migration steps 1 and 2).
3. If migrating an existing instance, restore the data dump (step 3) into the new
   database during a brief write freeze on the source.
4. Deploy the image to the compute service and let it boot. The owner row
   bootstraps idempotently on first start.
5. Smoke test: `GET /health` must return 200 with `database` and `secretStore`
   reachable; sign in as the owner; confirm the portal loads at "/".
6. Flip traffic. On Cloud Run, route 100 percent to the new revision; at the edge,
   point DNS or the load balancer at the new service. Keep the old environment
   warm until the new one is confirmed.

## Rollback

- Application or image regression: roll back to the previous known-good revision.
  On Cloud Run, shift traffic back to the prior revision (instant; the old
  revision is retained). On AWS, redeploy the previous image tag. The app is
  stateless, so this is a traffic or image change only.
- Database regression: restore from point-in-time recovery to a timestamp before
  the bad change, then repoint `DATABASE_URL` at the restored instance and
  redeploy. Because the provenance ledger is verified on restore, a restore that
  breaks a chain is surfaced rather than silently accepted.
- Secret rotation gone wrong: a rotated `SESSION_SECRET` invalidates every
  outstanding PIN by design; roll the secret back to the prior version in the
  platform secret manager and restart the service to recover the old sessions.

## Environment variable reference

| Variable                        | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                          | Listen port. Injected by the platform; defaults to 8080 in the image.   |
| `DATABASE_URL`                  | Postgres connection string. Read directly by the pg driver.             |
| `PORTAL_DIST_DIR`               | Directory of the built portal SPA the api-server serves at "/".         |
| `CORS_ORIGINS`                  | Comma-separated allowlist; closed by default (same-origin in prod).     |
| `SECRET_STORE_PROVIDER`         | `env` (default), `gcp`, or `aws`.                                        |
| `GCP_PROJECT_ID`                | Required to connect the GCP SecretStore.                                 |
| `AWS_SECRETS_MANAGER_REGION`    | Region for the AWS SecretStore (falls back to `AWS_REGION`).            |
| `AWS_ACCESS_KEY_ID` and friends | AWS credentials when not using a task or instance role.                 |
| `ARCHIVE_STORE_PROVIDER`        | `local` (default), `gcs`, or `s3`.                                       |
| `RATE_LIMIT_STORE`              | `memory` (default) or `postgres` (limits shared across instances).      |
| `GCS_ARCHIVE_BUCKET`            | Required to connect the GCS archive store.                              |
| `S3_ARCHIVE_BUCKET`             | Required to connect the S3 archive store.                               |
| `S3_ARCHIVE_REGION`             | Region for S3 archives (falls back to `AWS_REGION`).                    |
| `OWNER_EMAIL`                   | Bootstrap owner email (not a secret).                                    |
| `SESSION_SECRET`                | Session and PIN-pepper secret. Resolved through the SecretStore.         |
| `OWNER_PASSWORD`                | Bootstrap owner password. Resolved through the SecretStore.              |

The full GCP and AWS adapter knobs (token sources, endpoint overrides, timeouts)
are documented in `replit.md` and read lazily by the adapters.

## Image-size note

The runtime image carries the full workspace, including the dev dependencies the
migration and seed tooling needs, so one image can serve, migrate, and seed. An
operator who wants a smaller serve-only image can add a `pnpm prune --prod` stage
and run migrations from the build stage instead; the tradeoff is a second image
to manage. The default favours one versatile artifact over minimum size.
