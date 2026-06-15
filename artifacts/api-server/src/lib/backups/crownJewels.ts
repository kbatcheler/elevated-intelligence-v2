import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { type LedgerVerifyRow, verifyLedgerEntries } from "../provenance/ledger";

// Crown-jewel logical backup and a proven scratch restore (Phase U). The durable
// Postgres storage and point-in-time recovery are the platform's responsibility,
// the same honesty boundary the SecretStore draws around durable secret storage.
// What is genuinely provable here, on a single Postgres instance, is a LOGICAL
// backup: export the crown-jewel tables to a portable bundle, restore that bundle
// into an isolated scratch schema in the SAME database, and verify the restored
// row counts and the restored provenance chain. That is a real restore drill, not
// infrastructure PITR, and the runbook names the distinction precisely.
//
// The crown jewels are the tables whose loss could not be recomputed from a
// re-run: the derived signals, the append-only provenance ledger, the users, the
// invite PINs, and the per-tenant key references. tenant_keys carries only the
// kmsKeyRef reference, never key material (the material lives in the separate KMS
// boundary and is deliberately NOT exported here), so the bundle never holds a
// secret value: only ciphertext, one-way hashes, and references.
export const CROWN_JEWEL_TABLES = [
  "derived_signals",
  "provenance_ledger",
  "users",
  "invite_pins",
  "tenant_keys",
] as const;

export type CrownJewelTable = (typeof CROWN_JEWEL_TABLES)[number];

export interface CrownJewelBundle {
  kind: "crown-jewel-backup";
  version: 1;
  exportedAt: string;
  tables: { name: CrownJewelTable; rowCount: number; rows: Record<string, unknown>[] }[];
}

// A scratch schema name is generated internally and validated, because a schema
// name cannot be a bound parameter and is interpolated as raw SQL. Only lowercase
// letters, digits, and underscores, starting with a letter, so it can never carry
// an injection.
const SCHEMA_NAME = /^[a-z][a-z0-9_]{0,62}$/;

function assertSchemaName(name: string): void {
  if (!SCHEMA_NAME.test(name)) {
    throw new Error('Invalid scratch schema name "' + name + '".');
  }
}

export function newScratchSchemaName(now: Date = new Date()): string {
  const stamp = now.getTime().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return "scratch_restore_" + stamp + "_" + rand;
}

// Export every crown-jewel table to a portable bundle. row_to_json gives a
// generic, column-name-keyed JSON object per row, so the exporter does not hard
// code each table's columns and stays correct as the schema grows.
export async function exportCrownJewels(now: Date = new Date()): Promise<CrownJewelBundle> {
  const tables: CrownJewelBundle["tables"] = [];
  for (const name of CROWN_JEWEL_TABLES) {
    const res = await db.execute<{ row: Record<string, unknown> }>(
      sql`SELECT row_to_json(t) AS row FROM ${sql.raw("public." + name)} t`,
    );
    const rows = res.rows.map((r) => r.row);
    tables.push({ name, rowCount: rows.length, rows });
  }
  return { kind: "crown-jewel-backup", version: 1, exportedAt: now.toISOString(), tables };
}

export interface RestoreResult {
  schema: string;
  tables: { name: CrownJewelTable; expected: number; restored: number }[];
  countsMatch: boolean;
}

// Restore a bundle into a fresh isolated scratch schema in the same database.
// Each table is created structurally from its public counterpart (LIKE, with
// defaults and check and not-null constraints but not foreign keys or indexes, so
// the restore is self-contained and cannot collide with live data), then the
// bundle rows are inserted with json_populate_recordset. Returns per-table
// expected-vs-restored counts.
export async function restoreCrownJewelsIntoScratch(
  bundle: CrownJewelBundle,
  schema: string,
): Promise<RestoreResult> {
  assertSchemaName(schema);
  await db.execute(sql`CREATE SCHEMA ${sql.raw(schema)}`);

  const tables: RestoreResult["tables"] = [];
  let countsMatch = true;
  for (const table of bundle.tables) {
    const qualified = schema + "." + table.name;
    await db.execute(
      sql`CREATE TABLE ${sql.raw(qualified)} (LIKE ${sql.raw("public." + table.name)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
    );
    if (table.rows.length > 0) {
      await db.execute(
        sql`INSERT INTO ${sql.raw(qualified)} SELECT * FROM json_populate_recordset(NULL::${sql.raw(qualified)}, ${JSON.stringify(table.rows)}::json)`,
      );
    }
    const countRes = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM ${sql.raw(qualified)}`,
    );
    const restored = Number(countRes.rows[0]?.count ?? "0");
    if (restored !== table.rowCount) countsMatch = false;
    tables.push({ name: table.name, expected: table.rowCount, restored });
  }
  return { schema, tables, countsMatch };
}

export async function dropScratchSchema(schema: string): Promise<void> {
  assertSchemaName(schema);
  await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.raw(schema)} CASCADE`);
}

// Read the RESTORED provenance_ledger rows back out of the scratch schema (not the
// in-memory bundle), grouped by tenant, so the drill re-walks the chain over data
// that genuinely round-tripped through the restore. Verifying the bundle would only
// prove the export; the gate's claim is that the RESTORED rows still form an intact
// chain, so the proof must read scratch.
async function restoredLedgerRowsByTenant(schema: string): Promise<Map<string, LedgerVerifyRow[]>> {
  assertSchemaName(schema);
  const res = await db.execute<{
    id: string;
    tenant_id: string | null;
    claim_path: string | null;
    source_ref: string | null;
    content_hash: string;
    prev_hash: string | null;
  }>(
    sql`SELECT id, tenant_id, claim_path, source_ref, content_hash, prev_hash
        FROM ${sql.raw(schema + ".provenance_ledger")}`,
  );
  const byTenant = new Map<string, LedgerVerifyRow[]>();
  for (const row of res.rows) {
    const tenantId = row.tenant_id ?? "";
    const list = byTenant.get(tenantId) ?? [];
    list.push({
      id: row.id,
      claimPath: row.claim_path,
      sourceRef: row.source_ref,
      contentHash: row.content_hash,
      prevHash: row.prev_hash,
    });
    byTenant.set(tenantId, list);
  }
  return byTenant;
}

export interface RestoreDrillResult {
  schema: string;
  exportedAt: string;
  tables: RestoreResult["tables"];
  countsMatch: boolean;
  chainVerified: boolean;
  chainDetail?: string;
}

// The full drill: export the crown jewels, restore them into a fresh scratch
// schema, verify the counts match and every restored tenant chain re-verifies,
// then drop the scratch schema. The scratch schema is always dropped, even on a
// failure, so a drill never leaves residue in the database.
export async function runRestoreDrill(now: Date = new Date()): Promise<RestoreDrillResult> {
  const bundle = await exportCrownJewels(now);
  const schema = newScratchSchemaName(now);
  try {
    const restore = await restoreCrownJewelsIntoScratch(bundle, schema);
    let chainVerified = true;
    let chainDetail: string | undefined;
    const restored = await restoredLedgerRowsByTenant(schema);
    for (const [tenantId, rows] of restored.entries()) {
      const result = verifyLedgerEntries(tenantId, rows);
      if (!result.ok) {
        chainVerified = false;
        chainDetail = "tenant " + tenantId + ": " + (result.detail ?? "chain failed to verify");
        break;
      }
    }
    return {
      schema,
      exportedAt: bundle.exportedAt,
      tables: restore.tables,
      countsMatch: restore.countsMatch,
      chainVerified,
      chainDetail,
    };
  } finally {
    await dropScratchSchema(schema);
  }
}
