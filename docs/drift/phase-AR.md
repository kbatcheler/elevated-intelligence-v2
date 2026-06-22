# Phase AR: operational hardening (deploy posture and runbooks)

Phase id: AR. Name: operational hardening. Milestone: no (a gated per-phase stop). Phase AR is the FOURTH
phase of the Robustness and Magic wave (AO through AS), the post-AN follow-on wave that reopened the Elevated
Intelligence V2 build to harden the platform and sharpen its surface.

AR changes no product behaviour. Its deliverable is the deployment posture made explicit and self-consistent:
the shared rate-limit store stated as the production posture, the in-process scheduled loops documented as a
single-instance responsibility with a boot-time posture log, the provenance append-only database role marked a
REQUIRED fail-loud deploy step, the Terraform target aligned with the runbook, and a go-live checklist that
turns the owner-bootstrap and SESSION_SECRET facts into operator checkboxes.

## What already stood, and why AR is posture not code

Two of AR's three substrate pieces were already real, landed in the post-AN remediation: the config-gated
rate-limit store (`RATE_LIMIT_STORE` default `memory`, opt-in `postgres` routing both the auth fixed window and
the connector token bucket through shared `rate_limit_*` tables) and the provenance append-only database role
SQL (`infra/sql/provenance-ledger-append-only.sql`, which grants the runtime role only SELECT and INSERT and is
fail-loud under `ON_ERROR_STOP`). AR does NOT change the code default (it stays `memory` so the checks run with
no environment), and it does NOT rewrite the role SQL (it was already fail-loud). AR's honest scope is to make
the production posture explicit, self-consistent across code, infra, and docs, and visible at boot.

## The startup posture log

A new pure module, `artifacts/api-server/src/lib/ops/startupPosture.ts`, computes two posture lines and logs
them once at boot. `rateLimitPostureLine(store)` returns a WARN line when the active store is the in-memory
default (single-instance only, so a multi-instance deployment would not share the limit) and an INFO line when
it is `postgres` (shared across instances). `scheduledLoopPostureLine()` names the seven in-process scheduled
loops (connector maintenance, alert notifier, retention purge, backup archive, benchmark recompute, push
morning brief, sftp drop watcher) and states that they have no cross-instance coordination, so exactly one
always-on instance must be the loop runner. `logStartupPosture(logger, env)` emits both. The module is pure (it
reads the resolved store name and the static loop list, touches no database, mints no figure) and is called
once from `index.ts` after `app.listen`, so the running configuration is visible in the logs rather than
inferred. It is a CONFIGURATION statement, not telemetry: it reports what is configured, never a measured or
fabricated number.

## The Terraform aligned with the runbook

`infra/gcp/main.tf` now pins a single always-on instance (`min_instance_count = 1`, `max_instance_count = 1`,
previously 0 and 4) and sets `RATE_LIMIT_STORE=postgres`, with comments that explain both as the loop-runner
and shared-limit posture the runbook describes. The Terraform and the runbook now agree: the deployed target is
the single loop runner, and the rate limits are shared.

## The documentation

- `docs/go-live-checklist.md` (new) turns the deploy facts into nine checkbox sections an operator works down:
  secrets present before first boot, SESSION_SECRET stability, owner bootstrap, schema and canonical seed, the
  REQUIRED provenance append-only role, the rate-limit store and single-instance scaling posture, backups and
  disaster recovery, a smoke test, and rollback readiness. Nothing is optional unless it says so.
- `docs/deploy-readiness.md` gains a pointer to the checklist and a section on the single always-on loop-runner
  instance: the consequences of more than one instance (duplicate loop ticks, some absorbed by set-based or
  idempotent ticks, the rest wasted work), the scale-to-zero suspension, the GCP pin, the boot posture log, and
  the honest steady-state-versus-rollout caveat (a revision rollout briefly overlaps two revisions, a bounded
  duplicate-tick window, not a steady-state multiplier).
- `docs/migration-runbook.md` adds the `RATE_LIMIT_STORE=postgres` env bullet and a Scaling posture paragraph,
  marks the append-only hardening step REQUIRED and describes its fail-loud `ON_ERROR_STOP` behaviour, and adds
  the `RATE_LIMIT_STORE` row to the env reference table.

## Tests

`artifacts/api-server/src/lib/ops/startupPosture.test.ts` is a pure vitest unit test (no database): it asserts
the memory store yields a warning line that names the single-instance limitation, the postgres store yields an
info line that names the shared store, the loop posture line lists all seven loops and the single-loop-runner
requirement, and `logStartupPosture` emits both lines at their levels through an injected logger spy. Five
tests, all pure.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- The full suite is green with zero failures (api-server 656 tests across 80 files, up from 651 across 79 with
  the new five-test `startupPosture.test.ts`; edge-agent 10; plus the portal, cortex, connectors, db, and
  scripts suites).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase AR
  Markdown AND the infra and Dockerfile roots (swept manually because they sit outside the guard's configured
  roots), and a fresh database-wide row-cast over 185 text and jsonb columns across all 44 public base tables
  reports zero hits (AR writes no schema and no data, so the database side stays clean and is re-run fresh to
  claim zero honestly).
- Zero new npm dependencies (the phase added one pure module, one unit test, Terraform values, and
  documentation only).

## Honest marking

What is TEST-PROVEN here: that the startup posture lines are correct for each store (a memory warning naming the
single-instance limitation, a postgres info line naming the shared store), that the loop posture line names all
seven loops and the single-loop-runner requirement, and that both lines are emitted at boot at their levels.
What is the accepted boundary (logged drift): the single loop-runner is a DEPLOYMENT posture enforced by
pinning one always-on instance, not code-level leader election; scaling the request tier past one instance is a
deliberate future posture that needs a separate single loop-runner instance or per-loop leader election. The
shared rate-limit store and the append-only database role are operator deploy steps the application documents
and makes fail-loud where it owns the path; durable Postgres storage and point-in-time recovery remain the
platform's responsibility, which the runbook states rather than fakes.

Nothing is fabricated: the boot posture log reports the configured store and the static loop list, never a
measured or invented figure; a missing figure remains a disclosed dash, not a zero; and the production posture
is documented as a checklist the operator completes, not asserted as already done.

## Logged drift and deviations

- AR is posture and documentation, not new product code: two of its three substrate pieces (the config-gated
  rate-limit store and the append-only role SQL) were already real from the post-AN remediation, so AR makes
  the production posture explicit and self-consistent rather than rebuilding them. The code default for
  `RATE_LIMIT_STORE` deliberately stays `memory` so the checks run with no environment; `postgres` is the
  documented production posture set by the Terraform.
- The single loop-runner is a deployment posture (one always-on instance), not code-level leader election. A
  multi-instance request tier needs a separate single loop-runner instance or per-loop leader election; it is
  not the shipped default.
- A revision rollout briefly overlaps two Cloud Run revisions, a bounded window of possible duplicate loop
  ticks; the set-based and idempotent ticks absorb it and the rest ends when the old revision drains. Logged as
  an accepted operational caveat, documented in `docs/deploy-readiness.md`.

## Gate

Phase AR passed its architect `evaluate_task` review (PASS) after one documentation-precision remediation: the
runbook and checklist now state the steady-state-versus-rollout caveat so "exactly one" loop runner is not read
as an absolute during a revision rollout. The hard constraints hold (zero new dependencies, ASCII hyphen only
in source and data, no fabricated figure). The drift index, the rollup, and the V2 build report advance to "A
through AR". Phase AR is gated but not a milestone; the Robustness and Magic wave continues with Phase AS (the
signature surface).
