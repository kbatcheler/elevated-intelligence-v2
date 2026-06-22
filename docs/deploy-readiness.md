# Deploy readiness notes

Operational caveats to settle before a production deploy. None block phase
progress; they are facts an operator needs at go-live. Sourced from the Phase D
drift report and the cross-phase rollup. For the actionable, tick-box version of
these facts, see `docs/go-live-checklist.md`; this file is the rationale behind
each item.

## Rate limiter: in-memory by default, opt-in shared Postgres store

The auth rate limiter (login and register) is a fixed window. By default it is an
in-memory map: it resets on every restart and is not shared across instances.

- Single instance: the default is fine as is.
- More than one instance, or an autoscale deployment: each in-memory instance keeps
  its own counter, so the effective limit multiplies by the instance count. Set
  `RATE_LIMIT_STORE=postgres` to move the counters to the shared `rate_limit_counters`
  table so the limit holds across every instance. The table is created by the normal
  schema push; no other change is needed. Leave it unset (or `memory`) for the
  single-instance default.

The shared table never stores a raw client identifier. Each row is keyed by a one-way
HMAC of the limiter key (which includes the client IP and the login email) under a
SESSION_SECRET-derived pepper, so a leak of the table alone reveals neither who was
rate-limited nor from where. One consequence, shared with the invite-PIN pepper:
rotating SESSION_SECRET changes every digest and so resets the live windows, which is
harmless for short-lived rate-limit state.

## Connector rate-limit token buckets: in-memory by default, opt-in shared store

The per-connection token bucket and the throttle-retry state (Phase O) default to the
same in-memory behavior as the auth limiter. On a single instance they enforce the
connector's declared quota correctly; across more than one instance each keeps its own
bucket, so the effective quota multiplies by the instance count. The same
`RATE_LIMIT_STORE=postgres` flag moves the bucket state to the shared
`rate_limit_buckets` table (keyed by the same one-way HMAC, never a raw connection id),
so the quota holds across instances. Leave the flag unset to keep the single-worker
default, or pin connector refresh to a single worker instead.

## The deployed target runs a single always-on instance (the loop runner)

The seven in-process scheduled loops (connector maintenance, alert notifier,
retention purge, backup archive, benchmark recompute, push morning brief, sftp
drop watcher) are started once in the server entrypoint on unref'd,
non-overlapping timers. They have no cross-instance coordination, and a loop only
runs while its instance is alive. Two consequences follow:

- More than one instance runs every loop once per instance. Some ticks are
  idempotent or set-based (the backup archive skips an unchanged ledger, push
  events are recorded idempotently, the retention purge is set-based), but
  duplicate benchmark recompute, connector maintenance, sftp scans, and backup
  attempts are still wasted work and avoidable risk.
- A scale-to-zero instance suspends the loops until the next request wakes it.

So the provided GCP target pins exactly one always-on instance
(`min_instance_count = 1`, `max_instance_count = 1` in `infra/gcp/main.tf`) and
that instance is the single loop runner. It also sets `RATE_LIMIT_STORE=postgres`
so the rate limits hold across the brief two-revision overlap during a rollout
and so a future bump above one instance starts from a shared limit. Scaling the
request tier past one instance is a deliberate future posture that needs either a
separate single loop-runner instance or per-loop leader election; it is not the
shipped default.

The "exactly one" is the steady-state count. During a revision rollout Cloud Run
briefly runs the old and new revisions together, so a few duplicate loop ticks can
occur in that bounded window even at this setting. The set-based and idempotent
ticks (retention purge, backup archive, push events) absorb a duplicate; the rest
is brief, bounded wasted work that ends when the old revision drains, not a
steady-state multiplier. A drained or careful cut-over narrows the window further.

At boot the server logs this posture: the active rate-limit store (a warning when
it is the in-memory default, since that is single-instance only) and the single
loop-runner requirement, so an operator reads the running configuration from the
logs rather than inferring it.

## SESSION_SECRET is load bearing and should not be rotated casually

Both the session cookie signature and the invite-PIN code hash derive from
SESSION_SECRET. Rotating it has two simultaneous effects:

1. Every live session cookie becomes invalid, so all users must log in again.
2. Every outstanding invite PIN stops validating, because the stored code hash no
   longer matches. Any unused PINs must be re-minted after a rotation.

Keep SESSION_SECRET stable in production. If a rotation is ever required (suspected
leak), plan for a forced re-login and a re-mint of any live invite PINs.

## Owner bootstrap depends on deploy-time secrets

`ensureProviderOrgAndOwner()` runs at startup and needs OWNER_EMAIL,
OWNER_PASSWORD, and SESSION_SECRET present in the deployment environment, not only
in development. If they are missing the server logs and continues without creating
an owner, which leaves no one able to mint PINs. Confirm all three are set in the
production environment before first boot.

## Provenance ledger append-only is enforced in the app; harden it at the DB role too

The provenance ledger is append-only by contract: the module exposes only
`appendEntry` and `verifyChain`, links every entry to its predecessor by content
hash, and never updates or trims a row, so any edit breaks `verifyChain`. That is
the application-layer guarantee.

For a second line of defence, remove UPDATE and DELETE on `provenance_ledger`
from the least-privilege RUNTIME role so even a defect or a compromised app
process cannot mutate or trim the chain. Ship `infra/sql/provenance-ledger-append-only.sql`
at deploy time, once per environment, run by a privileged role against the runtime
role:

```
psql "$ADMIN_DATABASE_URL" -v app_role=YOUR_RUNTIME_ROLE \
  -f infra/sql/provenance-ledger-append-only.sql
```

The script revokes UPDATE, DELETE, TRUNCATE and (re)grants only SELECT and INSERT,
then verifies the result with a fail-loud `has_table_privilege` gate: if the runtime
role can still UPDATE, DELETE, or TRUNCATE the ledger through ANY path (a direct grant,
an inherited or group grant, or a grant to PUBLIC), or is missing SELECT or INSERT, the
script raises and aborts under `ON_ERROR_STOP`, so a partial hardening can never look
complete. It also prints the direct grants for a human-readable record. It is
intentionally a role grant, not a block trigger: tenant
deletion legitimately cascades through the `tenant_id` foreign key and is run by a
privileged role, so revoking from the runtime role alone is surgical and leaves
the cascade intact. The application code confirms no runtime path updates or
deletes the ledger.

This is not demonstrable on the single-role development database, where the one
`DATABASE_URL` connects as the owner and always retains every privilege. It
requires a distinct least-privilege runtime role, which is the correct production
posture regardless.

## Portal test coverage

The portal data layer is now unit tested across both surfaces: the /api auth calls
and the Access console admin calls (PINs, users, orgs, tenant bindings), including
every status-to-error and 401 branch. Full DOM-rendering component tests are still
deferred: they would require jsdom and a testing-library, which are new
dependencies held off under the zero-new-dependency rule. Revisit if and when that
rule is relaxed.
