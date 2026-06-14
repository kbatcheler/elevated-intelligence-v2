import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEATS } from "@workspace/cortex";
import { alertEventsTable, db, modelUsageTable, orgsTable, tenantsTable } from "@workspace/db";
import { assertSeedWithinBudget, monthStart } from "./budget";

// The budget governor's Phase P alert path against a real Postgres. With the
// global cap effectively disabled and a small per-tenant cap, a tenant whose real
// ledger spend sits between the alert threshold and the cap emits exactly ONE
// budget_threshold alert, and a second pass re-emits nothing (the dedupe is keyed
// by scope + tenant + calendar month). Rows are namespaced and removed afterwards.

const RUN = "budgettest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const reasonerModel = SEATS.reasoner.model;
const ids = { org: "", tenant: "" };
const monthKey = monthStart().toISOString().slice(0, 7);
let entityId = "";

const CAP_KEYS = [
  "SPEND_GLOBAL_MONTHLY_CAP_USD",
  "SPEND_TENANT_MONTHLY_CAP_USD",
  "SPEND_ALERT_THRESHOLD",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  const [org] = await db
    .insert(orgsTable)
    .values({ name: RUN + " Provider", type: "provider" })
    .returning({ id: orgsTable.id });
  ids.org = org!.id;

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Tenant", url: "https://t." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant!.id;
  entityId = "tenant:" + ids.tenant + ":" + monthKey;

  // Real ledger spend of 0.90 for this tenant, in the current month.
  await db.insert(modelUsageTable).values({
    tenantId: ids.tenant,
    runId: randomUUID(),
    stage: "score",
    layerKey: "business-performance",
    seat: "reasoner",
    model: reasonerModel,
    inputTokens: 1,
    outputTokens: 1,
    costUsd: "0.900000",
  });
});

afterAll(async () => {
  await db.delete(alertEventsTable).where(eq(alertEventsTable.entityId, entityId));
  await db.delete(modelUsageTable).where(eq(modelUsageTable.tenantId, ids.tenant));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  await db.delete(orgsTable).where(eq(orgsTable.id, ids.org));
});

beforeEach(() => {
  for (const k of CAP_KEYS) saved[k] = process.env[k];
  // Disable the global cap so only the per-tenant threshold can fire; tenant cap
  // 1.00 with the default 0.8 threshold means 0.90 of spend is in the alert band.
  process.env.SPEND_GLOBAL_MONTHLY_CAP_USD = "1000000";
  process.env.SPEND_TENANT_MONTHLY_CAP_USD = "1.00";
  process.env.SPEND_ALERT_THRESHOLD = "0.8";
});

afterEach(() => {
  for (const k of CAP_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function thresholdAlertCount(): Promise<number> {
  const rows = await db
    .select({ id: alertEventsTable.id })
    .from(alertEventsTable)
    .where(and(eq(alertEventsTable.type, "budget_threshold"), eq(alertEventsTable.entityId, entityId)));
  return rows.length;
}

describe("assertSeedWithinBudget budget_threshold alert", () => {
  it("emits exactly one budget_threshold alert in the band and dedupes on a second pass", async () => {
    // Seeding the layer is allowed (under the cap), and it crosses the threshold.
    await expect(assertSeedWithinBudget({ tenantId: ids.tenant })).resolves.toBeUndefined();
    expect(await thresholdAlertCount()).toBe(1);

    const [row] = await db
      .select({
        severity: alertEventsTable.severity,
        tenantId: alertEventsTable.tenantId,
        details: alertEventsTable.details,
      })
      .from(alertEventsTable)
      .where(and(eq(alertEventsTable.type, "budget_threshold"), eq(alertEventsTable.entityId, entityId)));
    expect(row!.tenantId).toBe(ids.tenant);
    expect((row!.details as { scope: string }).scope).toBe("tenant");

    // A second pass in the same month must not emit a duplicate.
    await expect(assertSeedWithinBudget({ tenantId: ids.tenant })).resolves.toBeUndefined();
    expect(await thresholdAlertCount()).toBe(1);
  });
});
