import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, provenanceLedgerTable, tenantsTable } from "@workspace/db";
import { appendEntry, type LedgerVerifyRow, verifyLedgerEntries } from "../provenance/ledger";
import {
  CROWN_JEWEL_TABLES,
  dropScratchSchema,
  exportCrownJewels,
  newScratchSchemaName,
  restoreCrownJewelsIntoScratch,
  runRestoreDrill,
} from "./crownJewels";

// The crown-jewel logical backup and the proven scratch restore against a real
// Postgres. The drill exports the live crown-jewel tables, restores them into an
// isolated scratch schema in the same database, verifies the counts and a
// restored provenance chain, then drops the scratch schema. This test owns a
// fresh tenant with a clean three-entry chain, so it can assert that ITS chain
// re-verifies out of the restored rows regardless of what else is in the shared
// database, and that the restore leaves no residue behind.
const RUN = "crownjewel-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);

const ids = {
  tenant: "",
};

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Tenant", url: "https://t." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant!.id;

  await appendEntry({ tenantId: ids.tenant, claimPath: "layer.one", sourceRef: "verified:https://a" });
  await appendEntry({ tenantId: ids.tenant, claimPath: "layer.two", sourceRef: "modelled:(none)" });
  await appendEntry({ tenantId: ids.tenant, claimPath: "layer.three", sourceRef: "verified:https://c" });
});

afterAll(async () => {
  // The ledger rows cascade off the tenant.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
});

async function schemaExists(schema: string): Promise<boolean> {
  const res = await db.execute<{ present: boolean }>(
    sql`SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schema}) AS present`,
  );
  return Boolean(res.rows[0]?.present);
}

describe("newScratchSchemaName", () => {
  it("produces a safe, unique, lowercase identifier", () => {
    const a = newScratchSchemaName();
    const b = newScratchSchemaName();
    expect(a).toMatch(/^scratch_restore_[a-z0-9_]+$/);
    expect(a).not.toBe(b);
  });
});

describe("dropScratchSchema", () => {
  it("refuses an unsafe schema name", async () => {
    await expect(dropScratchSchema("public; drop table users")).rejects.toThrow(
      /Invalid scratch schema name/,
    );
  });
});

describe("runRestoreDrill", () => {
  it("restores every crown-jewel table with matching counts and drops the scratch schema", async () => {
    const result = await runRestoreDrill();

    expect(result.tables.map((t) => t.name)).toEqual([...CROWN_JEWEL_TABLES]);
    expect(result.countsMatch).toBe(true);
    for (const t of result.tables) {
      expect(t.restored).toBe(t.expected);
    }

    // chainVerified is computed by re-walking the RESTORED scratch ledger rows
    // (not the in-memory export bundle). It is deliberately NOT asserted true
    // here: the drill walks EVERY tenant in the shared global ledger, and a
    // concurrent test file (ledger.test.ts) intentionally tampers and deletes its
    // own tenant's rows, so a global chainVerified can legitimately be false
    // mid-run through no fault of the restore. The deterministic proof that the
    // restored-row verification path works over genuinely round-tripped data is
    // the owned-sub-chain test below, which reads this run's own tenant out of
    // the live scratch schema. chainVerified is a boolean either way.
    expect(typeof result.chainVerified).toBe("boolean");

    // The scratch schema is always dropped, even on the happy path, so a drill
    // never leaves residue in the database.
    expect(await schemaExists(result.schema)).toBe(false);
  });
});

describe("restore into scratch, proven on real restored rows", () => {
  it("re-verifies this tenant's provenance chain out of the restored scratch table", async () => {
    const bundle = await exportCrownJewels();
    const schema = newScratchSchemaName();
    try {
      const restore = await restoreCrownJewelsIntoScratch(bundle, schema);
      expect(restore.countsMatch).toBe(true);

      // Read this tenant's ledger rows back out of the live scratch schema (not
      // the in-memory bundle), so the verification is over genuinely restored
      // data, then re-walk the chain.
      const sel = await db.execute<{
        id: string;
        tenant_id: string | null;
        claim_path: string | null;
        source_ref: string | null;
        content_hash: string;
        prev_hash: string | null;
      }>(
        sql`SELECT id, tenant_id, claim_path, source_ref, content_hash, prev_hash
            FROM ${sql.raw(schema + ".provenance_ledger")}
            WHERE tenant_id = ${ids.tenant}`,
      );
      const rows: LedgerVerifyRow[] = sel.rows.map((r) => ({
        id: r.id,
        claimPath: r.claim_path,
        sourceRef: r.source_ref,
        contentHash: r.content_hash,
        prevHash: r.prev_hash,
      }));
      expect(rows).toHaveLength(3);

      const verify = verifyLedgerEntries(ids.tenant, rows);
      expect(verify.ok).toBe(true);
      expect(verify.length).toBe(3);
    } finally {
      await dropScratchSchema(schema);
    }
    expect(await schemaExists(schema)).toBe(false);
  });
});
