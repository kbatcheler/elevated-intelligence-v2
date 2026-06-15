import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  layersTable,
  provenanceLedgerTable,
  tenantsTable,
} from "@workspace/db";
import { processSftpDropOnce } from "./sftpDrop";

// End-to-end exercise of the SFTP-drop ingestion path (Phase AE, path 4). It
// proves a file dropped into the per-tenant inbound tree is derived in memory
// and then DELETED whether it succeeds or fails (no raw artifact survives in the
// store or on disk, even for a rejected file), that an unparseable or unsupported
// file is rejected loudly and discarded rather than silently lost or re-processed,
// and that a drop for an unknown tenant is skipped. The SFTP server itself is out
// of scope by design (it is the available-not-connected boundary); the watcher is
// what we own and prove.
const RUN = `sftp-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SENTINEL = `RAW-SENTINEL-${RUN}`;

const log = { info() {}, warn() {}, error() {} };

const ids = { tenant: "" };
let root = "";
const L = { csv: `${RUN}-csv`, bad: `${RUN}-bad`, text: `${RUN}-text` };

async function seedLayer(key: string): Promise<void> {
  await db.insert(layersTable).values({
    key,
    name: "SFTP Test Layer",
    description: "ephemeral test layer",
    archetype: "Performance scorecard",
    heroDescription: "test",
    ownerPersona: "test",
    diagnosticQuestion: "is this layer real",
    metricDefinitions: { tiles: [] },
    rootCauses: [],
    actions: [],
    gaps: { items: [], closedBy: "test" },
    feeds: [],
    moduleGroup: "test",
    isCanonical: false,
    sortOrder: 9999,
  });
}

async function drop(tenantId: string, layer: string, filename: string, data: string): Promise<string> {
  const dir = join(root, tenantId, layer);
  await mkdir(dir, { recursive: true });
  const path = join(dir, filename);
  await writeFile(path, data, "utf8");
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function signalsFor(layer: string) {
  return db
    .select()
    .from(derivedSignalsTable)
    .where(eq(derivedSignalsTable.sourceConnectorKey, `ingest:sftp:${layer}`));
}

beforeAll(async () => {
  root = join(tmpdir(), RUN);
  await mkdir(root, { recursive: true });
  const t = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-t`, url: `https://${RUN}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = t[0]!.id;
  for (const key of Object.values(L)) await seedLayer(key);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  if (ids.tenant) await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  for (const key of Object.values(L)) await db.delete(layersTable).where(eq(layersTable.key, key));
});

describe("sftp drop watcher: derive-and-discard on the shared core", () => {
  it("derives a dropped csv, persists the math, and deletes the file", async () => {
    const path = await drop(
      ids.tenant,
      L.csv,
      "q1.csv",
      `revenue,region\n10,east ${SENTINEL}\n20,west ${SENTINEL}\n`,
    );
    const summary = await processSftpDropOnce(log, { root, quietMs: 0 });
    expect(summary.processed).toBe(1);
    expect(summary.rejected).toBe(0);

    // The raw file is gone.
    expect(await exists(path)).toBe(false);

    const rows = await signalsFor(L.csv);
    expect(rows).toHaveLength(5);
    for (const s of rows) {
      const v = s.value as Record<string, unknown>;
      expect(v.alg).toBe("AES-256-GCM");
      expect(JSON.stringify(v)).not.toContain(SENTINEL);
    }
    const prov = await db
      .select()
      .from(provenanceLedgerTable)
      .where(eq(provenanceLedgerTable.tenantId, ids.tenant));
    expect(prov.some((p) => p.claimPath === `ingestion:sftp:${L.csv}`)).toBe(true);
  });

  it("rejects an unsupported file type by discarding it, never re-processing it", async () => {
    const path = await drop(ids.tenant, L.bad, "notes.txt", "just some prose");
    const summary = await processSftpDropOnce(log, { root, quietMs: 0 });
    expect(summary.rejected).toBe(1);
    expect(summary.processed).toBe(0);
    // The rejected raw file is deleted, not parked on disk as a ".rejected" copy.
    expect(await exists(path)).toBe(false);
    expect(await exists(path + ".rejected")).toBe(false);

    // A second tick has nothing left to scan: the file was discarded, not re-queued.
    const again = await processSftpDropOnce(log, { root, quietMs: 0 });
    expect(again.scanned).toBe(0);
    expect(await signalsFor(L.bad)).toHaveLength(0);
  });

  it("rejects a spreadsheet with no numeric columns", async () => {
    const path = await drop(ids.tenant, L.text, "names.csv", "name,city\nalice,paris\nbob,rome\n");
    const summary = await processSftpDropOnce(log, { root, quietMs: 0 });
    expect(summary.rejected).toBe(1);
    // The rejected raw file is deleted, not parked on disk as a ".rejected" copy.
    expect(await exists(path)).toBe(false);
    expect(await exists(path + ".rejected")).toBe(false);
    expect(await signalsFor(L.text)).toHaveLength(0);
  });

  it("skips a drop directory for an unknown tenant", async () => {
    const stranger = randomUUID();
    await drop(stranger, L.csv, "x.csv", "revenue\n1\n2\n");
    const summary = await processSftpDropOnce(log, { root, quietMs: 0 });
    expect(summary.processed).toBe(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    // The stranger's file is untouched (still present), never ingested.
    const left = await readdir(join(root, stranger, L.csv));
    expect(left).toContain("x.csv");
  });

  it("skips a non-uuid directory at the drop root", async () => {
    await mkdir(join(root, "not-a-tenant"), { recursive: true });
    const summary = await processSftpDropOnce(log, { root, quietMs: 0 });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
  });
});
