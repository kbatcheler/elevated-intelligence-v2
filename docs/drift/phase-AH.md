# Phase AH: cloud portability

Phase id: AH. Name: cloud portability. Milestone: no (gated; the fifth phase of Stage 5, Platform
completion, run under the owner-authorized AE-through-AI sequence whose only milestone hard stop is
Phase AI). Phase AF paused at its own gate on the real-endpoint blocker; the owner authorized
proceeding, so the sequence runs through AG and AH to the AI milestone.

Phase AH makes the deployment portable off this single managed host without changing one product
guarantee. It adds a second cloud target for each "available, not connected" seam (AWS alongside the
existing GCP), proves the queue is safe across more than one running instance, and writes the deploy
artifacts (a container image, a local-parity compose file, a minimal executable GCP target, and a
migration runbook) so an owner can stand the system up on their own infrastructure. Zero new npm
dependencies (node:crypto and the Node global fetch only, no AWS SDK); ASCII hyphen only in source, in
data, and in these documents; no fabricated telemetry, health, or output; honest distinct loading,
empty, and error states.

## The shared SigV4 signer

`artifacts/api-server/src/lib/aws/sigv4.ts` is one zero-dependency AWS Signature Version 4 signer,
built on `node:crypto` alone, that both AWS adapters share so the signing logic lives in exactly one
place. It produces the canonical request, the string to sign, the derived signing key, and the
`Authorization` header for any AWS service: the canonical URI is single-encoded for `s3` and
double-encoded for every other service (the documented S3 exception), the query string is sorted, the
signed headers are lowercased, trimmed, and sorted, the required `host` and `x-amz-date` headers are
always signed with an optional `x-amz-security-token` when a session credential is present, and the
payload is hashed with sha256 (so a write-once `If-None-Match` header is part of the signed set for the
S3 path). Credentials resolve lazily from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and the
optional `AWS_SESSION_TOKEN`, and their absence throws a precise "AWS credentials are not configured:
set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to connect it." rather than signing with empty keys.
The signer is pinned by a golden test against AWS's own published IAM `ListUsers` example vector plus a
set of property tests for each canonicalization rule, so a regression in any signing step turns the
build red.

## The AWS Secrets Manager adapter (available, not connected)

`artifacts/api-server/src/lib/secrets/awsSecretsManagerSecretStore.ts` mirrors the Phase Q GCP Secret
Manager adapter exactly: it is "available, not connected" until configured, construction validates
nothing so an unset region never crashes the boot, and the first `get`, `set`, or `delete` resolves the
region lazily and throws "AWS Secrets Manager is available, not connected: set AWS_SECRETS_MANAGER_REGION
(or AWS_REGION) to connect it." when none is set. It implements the full surface over the SigV4 signer
and the Node global fetch with no SDK: `GetSecretValue` for read (a `ResourceNotFoundException` maps to
null, not an error), `CreateSecret` then `PutSecretValue` for write, and `DeleteSecret` for delete (a
`ResourceNotFoundException` is tolerated idempotently). The ref grammar is the SAME
`[A-Za-z0-9_-]{1,255}` validated before any network call as the GCP adapter, so a secret reference is
byte-identical across providers and a tenant `authRef` stays portable when the backend changes. Every
request is bounded by an `AbortController` timeout (`AWS_SECRETS_MANAGER_TIMEOUT_MS`), the endpoint is
overridable (`AWS_SECRETS_MANAGER_ENDPOINT`) for a test or a private link, and no secret value, token, or
response body is ever logged or attached to an error. `getSecretStore` selects it with
`SECRET_STORE_PROVIDER=aws`, alongside the existing `env` default and `gcp`.

## The S3 archive adapter (available, not connected)

`artifacts/api-server/src/lib/backups/s3ArchiveStore.ts` is the AWS sibling of the Phase U GCS archive
adapter, again zero-SDK over the shared SigV4 signer and the global fetch. It is "available, not
connected" by default: the bucket's absence is the connect error ("S3 archive store is available, not
connected: set S3_ARCHIVE_BUCKET to connect it."), and the region falls back from `S3_ARCHIVE_REGION` to
`AWS_REGION` with its own connect error when neither is set. It implements `put`, `get`, `list`, and
`describe`, where `describe` reports only `{ provider: "s3", connected }` (a boolean derived from
whether the bucket and region are set), never the bucket name, a path, or a credential, so the
owner-only backup status route stays non-secret. Write-once is enforced with the `If-None-Match: *`
precondition that S3 honours: a second write to the same key returns 412 and is surfaced as a loud
"Archive object already exists (write-once)" rather than a silent overwrite, preserving the ledger
archive's immutability guarantee. The endpoint is overridable (`S3_ARCHIVE_ENDPOINT`, default
`https://s3.<region>.amazonaws.com`) so the integration tests drive it path-style against an injected
fetch with no live bucket, and every request is timeout-bounded (`S3_ARCHIVE_TIMEOUT_MS`).
`createArchiveStore` selects it with `ARCHIVE_STORE_PROVIDER=s3`, alongside the existing `local` default
and `gcs`.

## Multi-instance queue ownership

The seed queue (`pipeline_jobs`) has always claimed each job with `FOR UPDATE SKIP LOCKED` inside a
transaction, the same pattern as the Phase P alert drain. Phase AH proves that guarantee holds across
more than one running process. A new integration test stands up two distinct instance ids, each running
its own worker pool, both draining one tenant's queue at once, and asserts that every layer is claimed
by exactly one worker, that the count of terminal rows equals the count of input jobs (nothing dropped,
nothing duplicated), and that the work is observably distributed across both instances rather than
starved onto one. This documents the operational contract: `LAYER_CONCURRENCY` is the per-instance
worker count, so the fleet-wide parallelism is `instances * LAYER_CONCURRENCY`. No fleet-wide ceiling is
claimed or enforced in code, because the queue itself, not a coordinator, is the safety boundary.

## Deploy artifacts

The deploy artifacts are written and ASCII-verified but NOT built here (this container has no Docker
daemon, and `terraform` is not run against a real cloud project):

- `Dockerfile` is a multi-stage image. The build stage runs on `node:22-bookworm-slim`, enables
  corepack with the repo's pinned `pnpm@10.26.1`, installs the workspace, and runs the full `build` so
  the portal is built to `dist/public` and the api-server is bundled to `dist/index.mjs`. The runtime
  stage copies the built `/app` and runs `node artifacts/api-server/dist/index.mjs` as the single
  process, twelve-factor and platform-agnostic: it reads `PORT` (8080), points
  `PORTAL_DIST_DIR=/app/artifacts/portal/dist/public` at the built portal so the one process serves the
  UI and the API, and carries a `HEALTHCHECK` against `/health`.
- `.dockerignore` keeps the build context lean (node_modules, dist, logs, local state).
- `docker-compose.yml` is the local-parity stack: a `postgres:16-bookworm` database, a one-shot
  `migrate` service that runs `pnpm --filter @workspace/db push` to apply the schema, the app, and an
  optional `seed` profile, so an owner gets the same database, migration, and run path on a laptop as in
  the cloud.
- `infra/gcp/*.tf` (`versions`, `variables`, `main`, `outputs`) is a minimal executable GCP target:
  Cloud Run v2 fronting the image, a `roles/run.invoker` grant to `allUsers` (gated by the
  `allow_unauthenticated` variable, default true) so the service URL is actually reachable by a browser
  and the runbook `GET /health` smoke test while the app keeps its own application-layer authorization, a
  Cloud SQL Postgres 16 instance, Secret Manager entries for `SESSION_SECRET` and `OWNER_PASSWORD` consumed
  through `SECRET_STORE_PROVIDER=gcp`, a `DATABASE_URL` delivered as a secret env over the Cloud SQL
  `/cloudsql` socket, and a GCS bucket for the ledger archive. The Terraform names the resources and the
  wiring; it is not applied here.
- `docs/migration-runbook.md` documents the move off the managed host: the GCP primary path (Cloud Run
  plus Cloud SQL plus Secret Manager plus GCS), the AWS equivalent (the adapters this phase added: AWS
  Secrets Manager and S3, with the same env-selected provider switch), the drizzle migration path
  (`pnpm --filter @workspace/db push`), and the cutover and rollback steps.

The api-server already serves the built portal when `PORTAL_DIST_DIR` is set (the container's single-
process model): `artifacts/api-server/src/app.ts` serves the static assets, excludes the `/api`, `/v1`,
and `/mcp` namespaces from the SPA fallback, and returns a JSON 404 for an unknown API path rather than
letting the HTML shell shadow it. Phase AH adds the integration test that pins this behaviour.

## Tests

- `artifacts/api-server/src/lib/aws/sigv4.test.ts` (9). The golden IAM `ListUsers` vector plus the
  canonicalization properties: single-encode for s3 and double-encode for other services, sorted query,
  sorted and trimmed signed headers, the required host and x-amz-date with an optional
  x-amz-security-token, the payload sha256, and the missing-credential error.
- `artifacts/api-server/src/lib/secrets/secretStore.test.ts` (+9, the `AwsSecretsManagerSecretStore`
  describe). Available-not-connected on a missing region, the get, set (create then put), and delete
  surface over an injected fetch, the ResourceNotFoundException to null and idempotent delete, the
  shared ref grammar, and the provider selection on `SECRET_STORE_PROVIDER=aws`.
- `artifacts/api-server/src/lib/backups/archiveStore.test.ts` (+10, the two `S3ArchiveStore` describes,
  4 plus 6). Available-not-connected on a missing bucket or region, the non-secret `describe`, put, get,
  and list over an injected fetch path-style, and the `If-None-Match: *` write-once 412.
- `artifacts/api-server/src/lib/pipeline/queue.integration.test.ts` (+2, now 4). Every job handed to
  exactly one of many concurrent claimers, and no double-processing across two simultaneous instances.
- `artifacts/api-server/src/routes/portalStatic.integration.test.ts` (5, new). The built portal is
  served when `PORTAL_DIST_DIR` is set, the SPA fallback serves the HTML shell for an app route, and the
  HTML shell never shadows an API-namespace path (a `/v1` unknown path returns 404 JSON and a session-
  gated `/api` unknown path returns 401 JSON, never the shell).

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built, api-server bundled).
- Full suite green at 888 tests (api-server 493 across 58 files, portal 234 across 18, cortex 110 across
  13, connectors 29 across 5, edge-agent 10 across 3, db 8, scripts 4), up 35 from Phase AG's 853, all
  in api-server (56 to 58 files). The new tests are sigv4 9 and portalStatic.integration 5 (two new
  files), the AwsSecretsManagerSecretStore describe (+9) in secretStore, the two S3ArchiveStore
  describes (+10) in archiveStore, and the multi-instance queue cases (+2).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this
  Phase AH Markdown, and a fresh database-wide cast over all 144 public text and jsonb columns across 39
  base tables (no schema added this phase) reports zero hits.
- Zero new npm dependencies. The AWS adapters use `node:crypto` and the Node global fetch only; no AWS
  SDK is added.

## Honest marking: proven here versus owner must run on a Docker host

What is TEST-PROVEN here, hermetically, through the workflows: the SigV4 signer against AWS's published
vector and the canonicalization properties; the AWS Secrets Manager adapter's full get, set, delete, and
available-not-connected surface over an injected fetch; the S3 archive adapter's put, get, list,
describe, and write-once 412 over an injected fetch; the cross-provider portable ref grammar; the queue
holding its exactly-once guarantee across two simultaneous instances against real Postgres; and the
single-process portal-plus-API serving with the API namespaces protected from the SPA shell.

What is NOT done here and is the owner's to run on a Docker host (claiming any of it as proven would be
fabrication):

- `docker build` of the `Dockerfile` and `docker compose up` of the local-parity stack. There is no
  Docker daemon in this container, so the image and the compose stack are written and ASCII-verified but
  not built or run here.
- A full demo seed end to end inside the container. That needs both a Docker host AND live model
  provider credentials (`AI_INTEGRATIONS_ANTHROPIC_*` and `AI_INTEGRATIONS_GEMINI_*` for the connected
  path), and a live frontier seed is deliberately not re-run for cost (live paid seeds happened in
  Phases C and F and were not repeated).
- A live AWS run of the Secrets Manager or S3 adapter against a real account. Both are
  available-not-connected by design and are proven against an injected fetch; the first real call needs
  real credentials, a region, and (for S3) a bucket the owner provisions.
- `terraform apply` of `infra/gcp` against a real GCP project, and the durable Postgres plus
  point-in-time recovery behind Cloud SQL, which the platform (or the owner's cloud) owns, not the
  application (the same honesty boundary Phases Q and U drew around durable secret and archive storage).

Nothing is fabricated: no figure in this report is produced for a path that was not actually run here,
and the cloud adapters report "available, not connected" until an owner connects them.

## Logged drift and deviations

- Reduced AH scope. The Stage 5 prompt's broad "cloud portability" is delivered as the buildable,
  provable core: a second cloud target for each existing seam (AWS Secrets Manager and S3 beside GCP and
  GCS), the multi-instance queue proof, and the deploy artifacts. The container parts (image build,
  compose up, full in-container seed) and the live-cloud applies are the documented owner-rerun
  boundary above, not skipped silently.
- The portal `PORTAL_DIST_DIR` single-process serving was already present in `app.ts` from an earlier
  phase; AH adds only the integration test that pins it. The original test draft asserted a 404 on an
  unknown `/api` path, but that path is session-gated and returns 401; the test was corrected to assert
  the honest 401 for `/api` and a 404 for `/v1`, so it proves the real behaviour rather than an assumed
  one.
- Root-level `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and `infra/gcp/*.tf` are outside the
  long-dash source guard's scan directories (`lib`, `artifacts`, `docs`, `scripts`); they were verified
  ASCII-only by manual inspection. `docs/migration-runbook.md` IS inside the scanned set and passes the
  guard.
- Stage 4 still-live item carried forward unchanged: a tenant case study is recomputed per public
  cold-link hit rather than cached (AB). Unrelated to cloud portability; carried in the rollup, not
  addressed here.

## Gate

Phase AH passed its architect `evaluate_task` review (PASS) after one remediation round. The first review
returned FAIL on a single deploy-artifact blocker: the GCP Terraform created the Cloud Run service and
output its URL but granted no `roles/run.invoker`, so the URL would have rejected every browser and the
runbook's `GET /health` smoke test, leaving the deployment unreachable as documented. The fix added a
gated `roles/run.invoker` grant to `allUsers` (the `allow_unauthenticated` variable, default true, with a
documented private-edge opt-out) plus the access-model documentation, and the three workflow gates were
re-run green before the PASS. The SigV4 signer, the two cloud adapters, the multi-instance queue proof,
the deploy artifacts, and the single-process portal serving were assessed correct and safe, and the hard
constraints (zero new dependencies, ASCII hyphen only, no fabricated output) hold. The drift index, the rollup, and the V2 build report are updated to "A through
AH". Phase AH is the cloud-portability phase of Stage 5 (Platform completion); per the owner-authorized
AE-through-AI sequence it does NOT pause at its own gate, and execution continues to Phase AI. The next
protocol milestone hard stop is Phase AI at the end of Stage 5.
