import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  orgsTable,
  retentionEventsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { verifyChain } from "../provenance/ledger";
import {
  eraseTenantDerivedSignals,
  getRetentionTtlDays,
  runRetentionPurge,
} from "./retention";

// Retention service against a real Postgres: the scheduled TTL purge and the
// operator erasure, exercised directly with an injected clock and authority.
// Rows are namespaced by a run id and removed afterwards so the suite is
// self-cleaning. The TTL purge is global, so this test only seeds signals that
// are either far past or well within any sane TTL, and asserts on its own
// tenants by id rather than on the global delete count.
const RUN = "rettest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const DAY_MS = 24 * 60 * 60 * 1000;

const silentLog = {
  info() {},
  error() {},
};

const ids = {
  org: "",
  owner: "",
  tenantPurge: "",
  tenantErase: "",
};

beforeAll(async () => {
  const [org] = await db
    .insert(orgsTable)
    .values({ name: RUN + " Provider", type: "provider" })
    .returning({ id: orgsTable.id });
  ids.org = org!.id;

  const [owner] = await db
    .insert(usersTable)
    .values({
      email: RUN + "-owner@example.com",
      displayName: "owner",
      passwordHash: "x",
      role: "provider-owner",
      status: "active",
      orgId: ids.org,
    })
    .returning({ id: usersTable.id });
  ids.owner = owner!.id;

  const [tp] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Purge", url: "https://purge." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  const [te] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Erase", url: "https://erase." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantPurge = tp!.id;
  ids.tenantErase = te!.id;
});

afterAll(async () => {
  const tenantIds = [ids.tenantPurge, ids.tenantErase];
  // retention_events.tenantId nulls out (does not cascade) on a tenant delete,
  // so clear those rows while the tenant id still matches; derived_signals and
  // provenance_ledger both cascade off the tenant.
  await db.delete(retentionEventsTable).where(inArray(retentionEventsTable.tenantId, tenantIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  await db.delete(usersTable).where(eq(usersTable.id, ids.owner));
  await db.delete(orgsTable).where(eq(orgsTable.id, ids.org));
});

describe("getRetentionTtlDays", () => {
  it("defaults to 90 days and honours a positive RETENTION_TTL_DAYS override", () => {
    const original = process.env.RETENTION_TTL_DAYS;
    try {
      delete process.env.RETENTION_TTL_DAYS;
      expect(getRetentionTtlDays()).toBe(90);
      process.env.RETENTION_TTL_DAYS = "30";
      expect(getRetentionTtlDays()).toBe(30);
      process.env.RETENTION_TTL_DAYS = "not-a-number";
      expect(getRetentionTtlDays()).toBe(90);
    } finally {
      if (original === undefined) delete process.env.RETENTION_TTL_DAYS;
      else process.env.RETENTION_TTL_DAYS = original;
    }
  });
});

describe("runRetentionPurge", () => {
  it("purges signals past the TTL, keeps refreshed ones, and audits per affected tenant", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 100 * DAY_MS);
    await db.insert(derivedSignalsTable).values([
      {
        tenantId: ids.tenantPurge,
        layerKey: "business-performance",
        signalKey: "stale_a",
        value: 0.1,
        computedAt: stale,
        sourceConnectorKey: "redshift",
      },
      {
        tenantId: ids.tenantPurge,
        layerKey: "business-performance",
        signalKey: "stale_b",
        value: 0.2,
        computedAt: stale,
        sourceConnectorKey: "redshift",
      },
      {
        tenantId: ids.tenantPurge,
        layerKey: "business-performance",
        signalKey: "fresh",
        value: 0.3,
        computedAt: now,
        sourceConnectorKey: "redshift",
      },
    ]);

    const outcome = await runRetentionPurge({ now, ttlDays: 90, log: silentLog });
    const mine = outcome.perTenant.find((p) => p.tenantId === ids.tenantPurge);
    expect(mine?.count).toBe(2);

    const remaining = await db
      .select({ signalKey: derivedSignalsTable.signalKey })
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, ids.tenantPurge));
    expect(remaining.map((r) => r.signalKey)).toEqual(["fresh"]);

    const audits = await db
      .select()
      .from(retentionEventsTable)
      .where(
        and(
          eq(retentionEventsTable.tenantId, ids.tenantPurge),
          eq(retentionEventsTable.action, "ttl_purge"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.deletedDerivedSignalCount).toBe(2);
    expect(audits[0]!.authorityRole).toBe("system");
    expect(audits[0]!.authorityUserId).toBeNull();
    expect(audits[0]!.redactionLedgerEntryId).toBeNull();
    expect((audits[0]!.scope as { ttlDays: number }).ttlDays).toBe(90);
  });

  it("writes no audit row on a tick that purges nothing", async () => {
    const now = new Date();
    const second = await runRetentionPurge({ now, ttlDays: 90, log: silentLog });
    expect(second.perTenant.find((p) => p.tenantId === ids.tenantPurge)).toBeUndefined();

    const audits = await db
      .select()
      .from(retentionEventsTable)
      .where(
        and(
          eq(retentionEventsTable.tenantId, ids.tenantPurge),
          eq(retentionEventsTable.action, "ttl_purge"),
        ),
      );
    expect(audits).toHaveLength(1); // still just the one from the first purge
  });
});

describe("eraseTenantDerivedSignals", () => {
  it("deletes a tenant's signals, appends a redaction, and keeps the chain intact", async () => {
    await db.insert(derivedSignalsTable).values([
      {
        tenantId: ids.tenantErase,
        layerKey: "business-performance",
        signalKey: "a",
        value: 0.5,
        sourceConnectorKey: "redshift",
        provenanceRef: "rootA",
      },
      {
        tenantId: ids.tenantErase,
        layerKey: "business-performance",
        signalKey: "b",
        value: 0.6,
        sourceConnectorKey: "redshift",
        provenanceRef: "rootB",
      },
    ]);

    expect((await verifyChain(ids.tenantErase)).ok).toBe(true);

    const result = await eraseTenantDerivedSignals({
      tenantId: ids.tenantErase,
      authority: { userId: ids.owner, role: "provider-owner" },
      reason: "data subject erasure request",
    });
    expect(result.deletedCount).toBe(2);
    expect(result.redactionSourceRef.startsWith("sha256:")).toBe(true);
    expect(result.redactionLedgerEntryId).toBeTruthy();

    const remaining = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, ids.tenantErase));
    expect(remaining).toHaveLength(0);

    // Append-only: the redaction is a normal chained entry, so the chain still
    // verifies after the erasure rather than being broken by a deletion.
    const verify = await verifyChain(ids.tenantErase);
    expect(verify.ok).toBe(true);
    expect(verify.length).toBe(1);

    const audit = await db
      .select()
      .from(retentionEventsTable)
      .where(eq(retentionEventsTable.id, result.auditRowId));
    expect(audit[0]!.action).toBe("tenant_erasure");
    expect(audit[0]!.authorityUserId).toBe(ids.owner);
    expect(audit[0]!.authorityRole).toBe("provider-owner");
    expect(audit[0]!.deletedDerivedSignalCount).toBe(2);
    expect(audit[0]!.redactionLedgerEntryId).toBe(result.redactionLedgerEntryId);
    expect(audit[0]!.reason).toBe("data subject erasure request");
  });

  it("records the request even when the tenant has no signals, and keeps the chain valid", async () => {
    const result = await eraseTenantDerivedSignals({
      tenantId: ids.tenantErase,
      authority: { userId: ids.owner, role: "provider-owner" },
    });
    expect(result.deletedCount).toBe(0);
    expect(result.redactionLedgerEntryId).toBeTruthy();

    const verify = await verifyChain(ids.tenantErase);
    expect(verify.ok).toBe(true);
    expect(verify.length).toBe(2); // two redaction entries, chain still intact
  });
});
