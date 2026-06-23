// purge:test-data
//
// Sweep orphaned, test-only rows out of the SHARED development Postgres.
//
//   pnpm --filter @workspace/api-server purge:test-data            # purge
//   pnpm --filter @workspace/api-server purge:test-data --dry-run  # report only
//
// Why this exists
// ---------------
// The integration suites namespace every row they create by a unique run id
// (`<prefix>-<Date.now()>-<rand>`) and delete those rows in `afterAll`. A crashed
// or interrupted run never reaches `afterAll`, so its rows are left behind. Over
// many runs the shared dev DB accumulates dozens of orphaned tenants, users and
// orgs. That accumulation is not just clutter: the provider-seat
// `GET /api/push/notifications` route upserts a default push rule across EVERY
// accessible tenant in one statement, so an ever-growing tenant set makes that
// "across all tenants" write progressively slower and is the canonical
// contention victim under the test runner. Keeping the dataset at a small, stable
// baseline keeps that route - and any other cross-tenant query - cheap.
//
// What is removed, and what is NOT
// --------------------------------
// Only rows that carry an unambiguous TEST marker are removed; real seed/demo
// data is preserved. Two markers, neither of which a real row can carry:
//   * the run-id signature `-<13-digit epoch ms>-<digits>` embedded in a name or
//     email by every test RUN constant, and
//   * the IANA-reserved `example.com` host, which every test tenant url and test
//     user email uses and which real demo tenants (real company domains) and the
//     real owner (a real address) never use.
// The four demo tenants (Hillman, Lattice, Hinge Health, Patagonia), the real
// provider org and the bootstrapped owner therefore match no marker and are
// always left untouched.
//
// Safety
// ------
// Everything runs in ONE transaction, in FK-dependency order. Deleting a tenant
// cascades to its derived signals, provenance ledger, layers, keys, connections,
// org_tenants links and the rest (all tenant FKs are ON DELETE CASCADE). The only
// FKs that are ON DELETE RESTRICT both point at `users`
// (`invite_pins.created_by`, `access_grants.granted_by`), so the test-scoped rows
// on those two tables are cleared before the test users themselves are deleted.

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

// The run-id signature minted by every integration RUN constant:
// `<prefix>-<Date.now()>-<Math.floor(rand*1e6)>`. Date.now() is 13 digits
// (through year 2286), followed by a hyphen and at least one more digit. A real
// company or person name never carries this shape.
const RUN_ID_RE = "-[0-9]{13}-[0-9]";

// A test tenant: an example.com host (every test tenant url) OR a run-id in its
// name. Real demo tenants use real company domains and plain names.
const testTenant = sql`(tenants.url ~* 'example\\.com' OR tenants.name ~ ${RUN_ID_RE})`;

// A test user: an @example.com address (every test email) OR a run-id in the
// address. The real owner uses a real address.
const testUser = sql`(users.email ~* '@example\\.com$' OR users.email ~ ${RUN_ID_RE})`;

// A test org has no url or email, only a name, which always embeds the run id.
// The real provider org has a plain name.
const testOrg = sql`(orgs.name ~ ${RUN_ID_RE})`;

export interface PurgeCounts {
  tenants: number;
  users: number;
  orgs: number;
}

async function countTestRows(executor: typeof db): Promise<PurgeCounts> {
  const tenants = await executor.execute(
    sql`SELECT count(*)::int AS n FROM tenants WHERE ${testTenant}`,
  );
  const users = await executor.execute(
    sql`SELECT count(*)::int AS n FROM users WHERE ${testUser}`,
  );
  const orgs = await executor.execute(
    sql`SELECT count(*)::int AS n FROM orgs WHERE ${testOrg}`,
  );
  return {
    tenants: Number((tenants.rows[0] as { n: number }).n),
    users: Number((users.rows[0] as { n: number }).n),
    orgs: Number((orgs.rows[0] as { n: number }).n),
  };
}

// Delete every test-marked tenant, user and org in one transaction, in
// FK-dependency order. Returns the number of rows removed from each top-level
// table (cascaded child rows are not counted). Idempotent: a second run with
// nothing orphaned removes zero rows.
export async function purgeTestData(): Promise<PurgeCounts> {
  return db.transaction(async (tx) => {
    // 1. Tenants first: ON DELETE CASCADE clears derived_signals,
    //    provenance_ledger, tenant_layers, tenant_keys, org_tenants, access_grants
    //    (by tenant_id), push_rules and the rest of the tenant subtree.
    const tenants = await tx.execute(
      sql`DELETE FROM tenants WHERE ${testTenant} RETURNING id`,
    );

    // 2. Clear the two ON DELETE RESTRICT references into users before deleting
    //    test users. invite_pins is not tenant-scoped, so its test rows (created
    //    by a test user or scoped to a test org) must be removed explicitly.
    await tx.execute(
      sql`DELETE FROM invite_pins
          WHERE created_by IN (SELECT id FROM users WHERE ${testUser})
             OR scope_org_id IN (SELECT id FROM orgs WHERE ${testOrg})`,
    );
    // access_grants.granted_by is also RESTRICT; rows scoped to a test tenant are
    // already gone via the tenant cascade, this clears any remainder.
    await tx.execute(
      sql`DELETE FROM access_grants
          WHERE granted_by IN (SELECT id FROM users WHERE ${testUser})`,
    );

    // 3. Test users (other user FKs are CASCADE or SET NULL).
    const users = await tx.execute(
      sql`DELETE FROM users WHERE ${testUser} RETURNING id`,
    );

    // 4. Test orgs (org_tenants already cascaded with the tenants above).
    const orgs = await tx.execute(
      sql`DELETE FROM orgs WHERE ${testOrg} RETURNING id`,
    );

    return {
      tenants: tenants.rowCount ?? tenants.rows.length,
      users: users.rowCount ?? users.rows.length,
      orgs: orgs.rowCount ?? orgs.rows.length,
    };
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const before = await countTestRows(db);
  console.log("");
  console.log("============== PURGE:TEST-DATA ==============");
  console.log(
    `test-marked rows found: ${before.tenants} tenants, ${before.users} users, ${before.orgs} orgs`,
  );

  if (dryRun) {
    console.log("dry-run: nothing deleted");
    console.log("============================================");
    return;
  }

  const removed = await purgeTestData();
  console.log(
    `removed: ${removed.tenants} tenants, ${removed.users} users, ${removed.orgs} orgs (plus cascaded children)`,
  );

  const after = await countTestRows(db);
  if (after.tenants !== 0 || after.users !== 0 || after.orgs !== 0) {
    console.log(
      `WARNING: residual test-marked rows remain: ${after.tenants} tenants, ${after.users} users, ${after.orgs} orgs`,
    );
    process.exitCode = 1;
  } else {
    console.log("baseline clean: no test-marked rows remain");
  }
  console.log("============================================");
}

// Run as a CLI only when invoked directly, not when imported (e.g. by the vitest
// global setup, which calls purgeTestData() and manages the pool lifecycle).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main()
    .catch((e) => {
      console.error(
        "purge:test-data failed:",
        e instanceof Error ? e.message : String(e),
      );
      process.exitCode = 1;
    })
    .finally(() => {
      void pool.end();
    });
}
