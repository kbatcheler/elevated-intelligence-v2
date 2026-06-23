// Vitest global setup: a pre-run sweep of orphaned test-only rows from the shared
// development Postgres, run ONCE before the suite (not per file). A crashed or
// interrupted prior run leaves its run-namespaced rows behind; without this they
// accumulate across runs and make the cross-tenant queries (notably the
// provider-seat push-notifications upsert) progressively slower under the runner.
//
// It removes only rows that carry an unambiguous test marker (see
// scripts/purgeTestData.ts); real seed/demo data is never touched. Set
// SKIP_TEST_DATA_PURGE=1 to opt out (e.g. when pointing the suite at a DB whose
// contents must not be modified).

import { pool } from "@workspace/db";
import { purgeTestData } from "./src/scripts/purgeTestData";

export default async function setup(): Promise<void> {
  if (process.env.SKIP_TEST_DATA_PURGE) {
    return;
  }
  try {
    const removed = await purgeTestData();
    if (removed.tenants || removed.users || removed.orgs) {
      console.log(
        `[vitest] purged orphaned test rows before run: ${removed.tenants} tenants, ${removed.users} users, ${removed.orgs} orgs`,
      );
    }
  } catch (e) {
    // Never block the suite on the sweep; surface it and continue.
    console.warn(
      "[vitest] test-data purge skipped after error:",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    // The global-setup process owns its own pool; close it so the run does not
    // leak an idle connection into the shared dev DB.
    await pool.end();
  }
}
