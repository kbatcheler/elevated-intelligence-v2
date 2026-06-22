# Phase AR: Operational Hardening (multi instance safe, go-live ready)

## Objective

Settle the operational caveats the deploy readiness notes already name, so the
platform is safe to run at more than one instance and is hardened at the database
role, not only in the application. None of this changes product behaviour; it
makes the product safe to put a paying tenant on.

## Ownership boundary

This phase owns `infra/**`, the `docs/**` runbooks and readiness notes, the rate
limit and connector bucket store DEFAULTS in their existing config modules, and
the provenance database role SQL. It does not touch `lib/cortex`,
`lib/connectors`, or any `artifacts/portal` page. It changes operational defaults
and infrastructure, never a product surface.

## Invariants (restated)

No new dependency. No raw client identifier in any shared store: every rate limit
and bucket row is keyed by a one way HMAC under a `SESSION_SECRET` derived pepper,
exactly as the existing tables are, so a leak of a table reveals neither who nor
from where. The provenance ledger stays append only and `verifyChain` stays
passing. ASCII hyphen only. Full suite green and long dash sweep zero before
close.

## Ordered tasks

1. Make the shared store the safe default for multi instance. Today
   `RATE_LIMIT_STORE` defaults to in memory, which multiplies the effective limit
   by the instance count. Change the documented and recommended posture: a single
   instance keeps the in memory default, but the production runbook and the deploy
   readiness note instruct `RATE_LIMIT_STORE=postgres` for any autoscaled or multi
   instance deployment, and the same flag is confirmed to move BOTH the auth fixed
   window and the connector token bucket and throttle retry state to the shared
   `rate_limit_counters` and `rate_limit_buckets` tables. Add a startup log line
   that states which store is active and warns when more than one instance is
   detected on the in memory default, so the multiplication can never happen
   silently. Do not change the keying; it is already a one way HMAC.
2. Ship the provenance append only database role hardening as a first class deploy
   step. Confirm `infra/sql/provenance-ledger-append-only.sql` revokes UPDATE,
   DELETE, and TRUNCATE and grants only SELECT and INSERT to the runtime role,
   with the fail loud `has_table_privilege` gate that aborts under
   `ON_ERROR_STOP` if the runtime role can still mutate the ledger through any
   path. Document it as a required once per environment step in the migration
   runbook, run by a privileged role against the runtime role, so the second line
   of defence is not optional folklore.
3. Confirm the owner bootstrap and `SESSION_SECRET` go-live facts are captured as
   a hard checklist, not prose: `OWNER_EMAIL`, `OWNER_PASSWORD`, and
   `SESSION_SECRET` must be present in the production environment before first
   boot or no owner is created and no one can mint PINs; `SESSION_SECRET` is load
   bearing for both the session cookie and the invite PIN hash and rotating it
   forces a re-login and a re-mint of live PINs. Turn these into a single
   `docs/go-live-checklist.md` with a checkbox per item and a clear owner.
4. Review the scheduled loops (retention purge, backup archive, notifier,
   connector maintenance) for the multi instance case and document the intended
   posture: either pin them to a single worker or confirm they are safe to run on
   every instance. State the decision in the runbook so it is a choice, not an
   accident.
5. Add or confirm a terraform plan check in `infra/gcp` is consistent with the
   documented production posture (secret store provider, archive store provider,
   database role), so the infrastructure as code and the runbook agree.

## What you must not do

Do not change any product behaviour, route, or portal surface. Do not change the
HMAC keying or store a raw identifier. Do not weaken the provenance append only
guarantee. Do not touch cortex, connectors, or portal code.

## Acceptance gate

The shared store is the documented and recommended default for multi instance and
a startup log makes the active store and any unsafe configuration loud; the
provenance database role hardening is a required, fail loud, documented deploy
step; a `go-live-checklist.md` captures the owner bootstrap and `SESSION_SECRET`
facts as checkboxes; the scheduled loop posture is a stated decision; infra as
code agrees with the runbook. `typecheck`, `build`, and `test` green. Long dash
sweep zero. Drift records written for phase AR: `docs/drift/phase-AR.md`, the build
report appended, the INDEX and rollup advanced to AR.
