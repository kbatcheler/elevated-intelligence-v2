import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  alertEventsTable,
  benchmarkConsentEventsTable,
  db,
  modelUsageTable,
  retentionEventsTable,
  tenantsTable,
} from "@workspace/db";
import { purgeTestData } from "./purgeTestData";

// The SET NULL telemetry/audit tables reference tenants ON DELETE SET NULL, so a
// test tenant delete would otherwise leave their rows behind nulled and
// unmatchable. This proves the purge sweeps those rows BY the test tenant id,
// before the tenant delete nulls them, while leaving a legitimately global row
// (one created with tenant_id already NULL) untouched. Rows are namespaced by a
// run id and a unique sentinel and removed afterwards so the suite is
// self-cleaning even on partial failure.
const RUN = "purgetelemetry-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const GLOBAL_SENTINEL = "global-control-" + RUN;

describe("purgeTestData sweeps SET NULL telemetry tied to test tenants", () => {
  // A legitimately global alert (tenant_id NULL by design, not by deletion) and a
  // no-tenant-scope cost row: both must survive the purge.
  const globalAlertId = randomUUID();
  const globalUsageId = randomUUID();

  afterAll(async () => {
    await db
      .delete(alertEventsTable)
      .where(inArray(alertEventsTable.id, [globalAlertId]));
    await db
      .delete(modelUsageTable)
      .where(inArray(modelUsageTable.id, [globalUsageId]));
  });

  it("removes telemetry for a deleted test tenant and preserves global rows", async () => {
    // A test tenant: example.com url and a run-id name, matching the purge marker.
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ name: "Purge Telemetry " + RUN, url: "https://" + RUN + ".example.com" })
      .returning({ id: tenantsTable.id });
    const tenantId = tenant.id;

    // One row in each directly-insertable SET NULL telemetry/audit table, tied to
    // the test tenant.
    const [usage] = await db
      .insert(modelUsageTable)
      .values({
        tenantId,
        stage: "perceive",
        seat: "lens",
        model: "test-model",
        costUsd: "0.000000",
      })
      .returning({ id: modelUsageTable.id });
    const [alert] = await db
      .insert(alertEventsTable)
      .values({
        tenantId,
        type: "connector_error_transition",
        message: "purge telemetry test alert " + RUN,
      })
      .returning({ id: alertEventsTable.id });
    const [consent] = await db
      .insert(benchmarkConsentEventsTable)
      .values({ tenantId, action: "opt_in", authorityRole: "provider-owner" })
      .returning({ id: benchmarkConsentEventsTable.id });
    const [retention] = await db
      .insert(retentionEventsTable)
      .values({ tenantId, action: "ttl_purge", authorityRole: "system" })
      .returning({ id: retentionEventsTable.id });

    // Two legitimately global rows: tenant_id NULL by design. The purge must
    // leave these alone because they are not tied to any test tenant id.
    await db.insert(alertEventsTable).values({
      id: globalAlertId,
      tenantId: null,
      type: "provenance_integrity_failed",
      message: GLOBAL_SENTINEL,
    });
    await db.insert(modelUsageTable).values({
      id: globalUsageId,
      tenantId: null,
      stage: "profile",
      seat: "lens",
      model: "test-model",
      costUsd: "0.000000",
    });

    const removed = await purgeTestData();

    // The test tenant and at least its four telemetry rows are gone.
    expect(removed.tenants).toBeGreaterThanOrEqual(1);
    expect(removed.telemetry).toBeGreaterThanOrEqual(4);

    const tenantRows = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(inArray(tenantsTable.id, [tenantId]));
    expect(tenantRows).toHaveLength(0);

    const usageRows = await db
      .select({ id: modelUsageTable.id })
      .from(modelUsageTable)
      .where(inArray(modelUsageTable.id, [usage.id]));
    const alertRows = await db
      .select({ id: alertEventsTable.id })
      .from(alertEventsTable)
      .where(inArray(alertEventsTable.id, [alert.id]));
    const consentRows = await db
      .select({ id: benchmarkConsentEventsTable.id })
      .from(benchmarkConsentEventsTable)
      .where(inArray(benchmarkConsentEventsTable.id, [consent.id]));
    const retentionRows = await db
      .select({ id: retentionEventsTable.id })
      .from(retentionEventsTable)
      .where(inArray(retentionEventsTable.id, [retention.id]));
    expect(usageRows).toHaveLength(0);
    expect(alertRows).toHaveLength(0);
    expect(consentRows).toHaveLength(0);
    expect(retentionRows).toHaveLength(0);

    // The two global rows survive: a NULL tenant_id is not a test marker.
    const globalAlert = await db
      .select({ id: alertEventsTable.id })
      .from(alertEventsTable)
      .where(inArray(alertEventsTable.id, [globalAlertId]));
    const globalUsage = await db
      .select({ id: modelUsageTable.id })
      .from(modelUsageTable)
      .where(inArray(modelUsageTable.id, [globalUsageId]));
    expect(globalAlert).toHaveLength(1);
    expect(globalUsage).toHaveLength(1);
  });
});
