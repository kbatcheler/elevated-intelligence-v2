---
name: Orphaned test-data purge (shared dev DB)
description: How orphaned integration-test rows are swept from the shared dev Postgres and why the markers are safe.
---

# Orphaned test-data purge

Integration suites namespace every row by a RUN constant `<prefix>-<Date.now()>-<rand>`
and delete them in `afterAll`. Crashed/interrupted runs skip `afterAll`, so rows pile up in
the ONE shared dev DB. Accumulated tenants make the provider-seat push-notifications
upsert (which writes a default rule across EVERY accessible tenant) progressively slower
under the runner.

## The sweep
- Reusable `purgeTestData()` + CLI in `artifacts/api-server/src/scripts/purgeTestData.ts`
  (`pnpm --filter @workspace/api-server purge:test-data [--dry-run]`).
- Wired as a vitest `globalSetup` (`artifacts/api-server/vitest.globalSetup.ts`) so it runs
  ONCE before the suite; opt out with `SKIP_TEST_DATA_PURGE=1`.

## Why the markers are safe
A row is "test" only if it carries a marker no real row can have:
- run-id signature `-[0-9]{13}-[0-9]` (every RUN embeds it in a name/email), and/or
- the IANA-reserved `example.com` host (every test tenant url / test user email uses it).

Real data never matches: demo tenants use real company domains (Hillman/Lattice/Hinge
Health/Patagonia), the real owner is a real address, the real provider org has a plain name.
The clean baseline is exactly 4 tenants, 1 user, 1 org.

## Deletion order (FK-aware)
All tenant FKs are ON DELETE CASCADE, so deleting test tenants clears their whole subtree.
The only ON DELETE RESTRICT FKs both point at `users` (`invite_pins.created_by`,
`access_grants.granted_by`) — clear those test-scoped rows BEFORE deleting test users.
Order in one transaction: tenants -> invite_pins/access_grants -> users -> orgs.

**Why:** a source guard can't stop runtime row accumulation; the sweep must be marker-based
and FK-ordered so it removes only test rows and never trips a RESTRICT.
