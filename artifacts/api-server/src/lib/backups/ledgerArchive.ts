import { createHash } from "node:crypto";
import { asc, desc } from "drizzle-orm";
import { backupEventsTable, db, provenanceLedgerTable } from "@workspace/db";
import { type LedgerVerifyRow, verifyLedgerEntries } from "../provenance/ledger";
import { type ArchiveStore, getArchiveStore } from "./archiveStore";

// The provenance ledger archive (Phase U). The append-only, hash-chained ledger
// is both the product's provenance feature and the audit's processing-integrity
// evidence, so it is exported to durable object storage on a schedule. The export
// doubles as a tamper-evidence archive: it carries a verifiable copy of every
// chain and a sha256 over the canonical bytes, so a restore can prove the archive
// was not altered, and so a database loss does not take the chain with it.
//
// Honest by design: an empty ledger or a ledger unchanged since the last archive
// writes no object and no audit row, returning a "skipped" status, so the archive
// store and the backup audit never fill with redundant snapshots.

export interface LedgerArchiveLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

export interface LedgerArchiveResult {
  status: "archived" | "skipped";
  reason?: string;
  objectKey?: string;
  sha256: string;
  entryCount: number;
  tenantCount: number;
  chainVerified: boolean;
  storeProvider: string;
}

export interface LedgerArchiveDeps {
  store?: ArchiveStore;
  now?: Date;
  authority?: { userId: string | null; role: string };
  log?: LedgerArchiveLogger;
}

interface ArchivedTenant {
  tenantId: string;
  length: number;
  verified: boolean;
}

// A canonical, stable-order serialisation of the whole ledger plus a manifest, so
// the same ledger state always produces the same bytes and therefore the same
// sha256. Entries are sorted by tenant then by createdAt then id, and the object
// keys are emitted in a fixed order, so the digest is reproducible. The digest is
// deliberately over the ledger CONTENT only and carries no wall-clock field: a
// timestamp would make every archive of an unchanged ledger differ, which would
// defeat the skip-unchanged path. The "when" of an archive lives in the object
// key and the backup_events.createdAt, not in the digested bytes.
function canonicalArchive(input: {
  entries: {
    id: string;
    tenantId: string | null;
    claimPath: string | null;
    sourceRef: string | null;
    contentHash: string;
    prevHash: string | null;
    createdAt: string;
  }[];
  tenants: ArchivedTenant[];
}): string {
  return JSON.stringify({
    kind: "provenance-ledger-archive",
    version: 1,
    entryCount: input.entries.length,
    tenants: input.tenants,
    entries: input.entries,
  });
}

function compactTimestamp(d: Date): string {
  // 2026-06-15T12-34-56-789Z, a valid archive key segment (no colon or dot).
  return d.toISOString().replace(/[:.]/g, "-");
}

// Export the provenance ledger to the archive store. Reads every ledger row,
// re-verifies each tenant chain, serialises canonically, and writes a write-once
// object, recording one backup_events audit row. Skips (writing nothing) when
// the ledger is empty or unchanged since the last archive.
export async function exportLedgerArchive(deps: LedgerArchiveDeps = {}): Promise<LedgerArchiveResult> {
  const store = deps.store ?? getArchiveStore();
  const now = deps.now ?? new Date();
  const authority = deps.authority ?? { userId: null, role: "system" };
  const description = store.describe();

  const rows = await db
    .select()
    .from(provenanceLedgerTable)
    .orderBy(asc(provenanceLedgerTable.tenantId), asc(provenanceLedgerTable.createdAt), asc(provenanceLedgerTable.id));

  if (rows.length === 0) {
    return {
      status: "skipped",
      reason: "no ledger entries",
      sha256: "",
      entryCount: 0,
      tenantCount: 0,
      chainVerified: true,
      storeProvider: description.provider,
    };
  }

  // Group by tenant and re-verify each chain over exactly the rows being archived.
  const byTenant = new Map<string, LedgerVerifyRow[]>();
  for (const r of rows) {
    const key = r.tenantId ?? "";
    const list = byTenant.get(key) ?? [];
    list.push({
      id: r.id,
      claimPath: r.claimPath,
      sourceRef: r.sourceRef,
      contentHash: r.contentHash,
      prevHash: r.prevHash,
    });
    byTenant.set(key, list);
  }
  const tenants: ArchivedTenant[] = [];
  let chainVerified = true;
  for (const [tenantId, list] of [...byTenant.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const result = verifyLedgerEntries(tenantId, list);
    if (!result.ok) chainVerified = false;
    tenants.push({ tenantId, length: list.length, verified: result.ok });
  }

  const canonical = canonicalArchive({
    entries: rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      claimPath: r.claimPath,
      sourceRef: r.sourceRef,
      contentHash: r.contentHash,
      prevHash: r.prevHash,
      createdAt: r.createdAt.toISOString(),
    })),
    tenants,
  });
  const sha256 = createHash("sha256").update(canonical, "utf8").digest("hex");

  // Skip if the ledger is byte-identical to the last archived snapshot, so a
  // schedule that runs against an unchanged ledger does not write a new object.
  const last = await db
    .select({ sha256: backupEventsTable.sha256 })
    .from(backupEventsTable)
    .orderBy(desc(backupEventsTable.createdAt))
    .limit(1);
  if (last[0]?.sha256 === sha256) {
    return {
      status: "skipped",
      reason: "no change since last archive",
      sha256,
      entryCount: rows.length,
      tenantCount: tenants.length,
      chainVerified,
      storeProvider: description.provider,
    };
  }

  const objectKey = "ledger/" + compactTimestamp(now) + "-" + sha256.slice(0, 16) + ".json";
  await store.put(objectKey, Buffer.from(canonical, "utf8"), { writeOnce: true });

  await db.insert(backupEventsTable).values({
    action: "ledger_archive",
    objectKey,
    storeProvider: description.provider,
    sha256,
    entryCount: rows.length,
    tenantCount: tenants.length,
    chainVerified,
    authorityUserId: authority.userId,
    authorityRole: authority.role,
    reason: authority.role === "system" ? "scheduled ledger archive" : "manual ledger archive",
  });

  deps.log?.info(
    {
      objectKey,
      sha256,
      entryCount: rows.length,
      tenantCount: tenants.length,
      chainVerified,
      storeProvider: description.provider,
    },
    "provenance ledger archived",
  );

  return {
    status: "archived",
    objectKey,
    sha256,
    entryCount: rows.length,
    tenantCount: tenants.length,
    chainVerified,
    storeProvider: description.provider,
  };
}

// Read an archived object back and re-verify it: confirm the stored sha256 still
// matches the bytes, and re-walk every tenant chain it carries. Proves an archive
// holds an intact, untampered copy of the chain, not an assumed one.
export interface ArchiveVerifyResult {
  ok: boolean;
  sha256: string;
  entryCount: number;
  tenantCount: number;
  detail?: string;
}

export async function verifyLedgerArchiveObject(
  objectKey: string,
  expectedSha256: string,
  store: ArchiveStore = getArchiveStore(),
): Promise<ArchiveVerifyResult> {
  const bytes = await store.get(objectKey);
  if (bytes === null) {
    return { ok: false, sha256: "", entryCount: 0, tenantCount: 0, detail: "archive object not found" };
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    return { ok: false, sha256: actual, entryCount: 0, tenantCount: 0, detail: "archive bytes do not match recorded sha256" };
  }
  const parsed = JSON.parse(bytes.toString("utf8")) as {
    entries: {
      id: string;
      tenantId: string | null;
      claimPath: string | null;
      sourceRef: string | null;
      contentHash: string;
      prevHash: string | null;
    }[];
    tenants: ArchivedTenant[];
  };
  const byTenant = new Map<string, LedgerVerifyRow[]>();
  for (const e of parsed.entries) {
    const key = e.tenantId ?? "";
    const list = byTenant.get(key) ?? [];
    list.push({ id: e.id, claimPath: e.claimPath, sourceRef: e.sourceRef, contentHash: e.contentHash, prevHash: e.prevHash });
    byTenant.set(key, list);
  }
  for (const [tenantId, list] of byTenant.entries()) {
    const result = verifyLedgerEntries(tenantId, list);
    if (!result.ok) {
      return {
        ok: false,
        sha256: actual,
        entryCount: parsed.entries.length,
        tenantCount: byTenant.size,
        detail: "tenant chain failed to verify: " + (result.detail ?? "unknown"),
      };
    }
  }
  return { ok: true, sha256: actual, entryCount: parsed.entries.length, tenantCount: byTenant.size };
}
