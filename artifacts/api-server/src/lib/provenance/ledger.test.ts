import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, provenanceLedgerTable, tenantsTable } from "@workspace/db";
import * as ledger from "./ledger";
import { appendEntry, verifyChain } from "./ledger";

// The hash-chained provenance ledger against a real Postgres. Each test owns a
// throwaway tenant so chains never collide; deleting the tenant cascades the
// ledger rows clean.
const RUN = "ledger-test-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const tenantIds: string[] = [];

async function freshTenant(suffix: string): Promise<string> {
  const inserted = await db
    .insert(tenantsTable)
    .values({
      name: RUN + "-" + suffix,
      url: "https://" + RUN + "-" + suffix + ".example.com",
      status: "ready",
    })
    .returning({ id: tenantsTable.id });
  const id = inserted[0]!.id;
  tenantIds.push(id);
  return id;
}

async function rowsFor(tenantId: string) {
  return db
    .select()
    .from(provenanceLedgerTable)
    .where(eq(provenanceLedgerTable.tenantId, tenantId))
    .orderBy(asc(provenanceLedgerTable.createdAt));
}

beforeAll(async () => {
  // Nothing global; each test provisions its own tenant.
});

afterAll(async () => {
  for (const id of tenantIds) {
    await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  }
});

describe("provenance ledger", () => {
  it("exposes only append and verify operations (append-only surface)", () => {
    const exported = Object.keys(ledger).sort();
    // appendEntry runs in its own transaction; appendEntryTx composes the same
    // append inside a caller's transaction (used by the retention erasure).
    // verifyChain re-walks a tenant's stored chain; verifyLedgerEntries is the
    // pure, read-only verifier it shares with the backup archive and restore.
    // Every export only appends or verifies; there is deliberately no update and
    // no delete export, which is what keeps the ledger tamper-evident.
    expect(exported).toEqual(["appendEntry", "appendEntryTx", "verifyChain", "verifyLedgerEntries"]);
  });

  it("chains each entry to its predecessor by content hash", async () => {
    const tenantId = await freshTenant("order");
    const a = await appendEntry({ tenantId, claimPath: "layer.one", sourceRef: "verified:https://a" });
    const b = await appendEntry({ tenantId, claimPath: "layer.two", sourceRef: "modelled:(none)" });
    const c = await appendEntry({ tenantId, claimPath: "layer.three", sourceRef: "verified:https://c" });

    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBe(a.contentHash);
    expect(c.prevHash).toBe(b.contentHash);

    const rows = await rowsFor(tenantId);
    expect(rows).toHaveLength(3);
  });

  it("verifies a clean chain", async () => {
    const tenantId = await freshTenant("clean");
    await appendEntry({ tenantId, claimPath: "p.one", sourceRef: "verified:https://x" });
    await appendEntry({ tenantId, claimPath: "p.two", sourceRef: "modelled:(none)" });
    const result = await verifyChain(tenantId);
    expect(result).toMatchObject({ ok: true, length: 2 });
  });

  it("verifies an empty chain as true with length zero", async () => {
    const tenantId = await freshTenant("empty");
    expect(await verifyChain(tenantId)).toMatchObject({ ok: true, length: 0 });
  });

  it("detects a tampered entry (a field edited after the fact)", async () => {
    const tenantId = await freshTenant("tamper");
    await appendEntry({ tenantId, claimPath: "t.one", sourceRef: "verified:https://1" });
    const mid = await appendEntry({ tenantId, claimPath: "t.two", sourceRef: "verified:https://2" });
    await appendEntry({ tenantId, claimPath: "t.three", sourceRef: "verified:https://3" });

    // Edit a stored field without recomputing the hash: the rewalk must catch it.
    await db
      .update(provenanceLedgerTable)
      .set({ sourceRef: "verified:https://TAMPERED" })
      .where(eq(provenanceLedgerTable.id, mid.id));

    const result = await verifyChain(tenantId);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("detects a deleted middle entry (a broken link)", async () => {
    const tenantId = await freshTenant("delete");
    await appendEntry({ tenantId, claimPath: "d.one", sourceRef: "verified:https://1" });
    const mid = await appendEntry({ tenantId, claimPath: "d.two", sourceRef: "verified:https://2" });
    await appendEntry({ tenantId, claimPath: "d.three", sourceRef: "verified:https://3" });

    await db.delete(provenanceLedgerTable).where(eq(provenanceLedgerTable.id, mid.id));

    const result = await verifyChain(tenantId);
    expect(result.ok).toBe(false);
  });

  it("keeps separate tenants on independent chains", async () => {
    const t1 = await freshTenant("iso1");
    const t2 = await freshTenant("iso2");
    const a = await appendEntry({ tenantId: t1, claimPath: "i.one", sourceRef: "verified:https://1" });
    const b = await appendEntry({ tenantId: t2, claimPath: "i.one", sourceRef: "verified:https://1" });
    // Both are genesis entries for their own tenant.
    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBeNull();
    expect(await verifyChain(t1)).toMatchObject({ ok: true, length: 1 });
    expect(await verifyChain(t2)).toMatchObject({ ok: true, length: 1 });
  });
});
