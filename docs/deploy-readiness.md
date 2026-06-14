# Deploy readiness notes

Operational caveats to settle before a production deploy. None block phase
progress; they are facts an operator needs at go-live. Sourced from the Phase D
drift report and the cross-phase rollup.

## Rate limiter is in-memory and per process

The auth rate limiter (login and register) is an in-memory fixed window. It resets
on every restart and is not shared across instances.

- Single instance: fine as is.
- More than one instance, or an autoscale deployment: each instance would keep its
  own counter, so the effective limit multiplies by the instance count. Move the
  limiter to a shared store (for example a Postgres-backed or Redis counter) before
  scaling horizontally.

## Connector rate-limit token buckets are in-memory and per process

The per-connection token bucket and the throttle-retry state (Phase O) live in process,
like the auth limiter. On a single instance they enforce the connector's declared quota
correctly; across more than one instance each would keep its own bucket, so the effective
quota multiplies by the instance count. Move the bucket state to a shared store before
running the connected-refresh path on more than one instance, or pin connector refresh to a
single worker.

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

## Portal test coverage

The portal data layer is now unit tested across both surfaces: the /api auth calls
and the Access console admin calls (PINs, users, orgs, tenant bindings), including
every status-to-error and 401 branch. Full DOM-rendering component tests are still
deferred: they would require jsdom and a testing-library, which are new
dependencies held off under the zero-new-dependency rule. Revisit if and when that
rule is relaxed.
