import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, provenanceLedgerTable, type ProvenanceLedgerEntry } from "@workspace/db";

// Append-only, hash-chained provenance. Each entry's contentHash chains to the
// previous entry's contentHash for the same tenant, so any reorder, edit, or
// deletion is detectable by re-walking the chain. Only references and content
// hashes are stored, never raw data. The exposed surface is deliberately just
// appendEntry and verifyChain: there is no update and no delete, which is what
// makes the ledger tamper-evident processing-integrity evidence.

export interface AppendEntryInput {
  tenantId: string;
  claimPath: string;
  sourceRef: string;
}

// Canonical, stable-key-order serialisation so the same logical entry always
// hashes the same way. ASCII only; no ambiguity from key ordering.
function canonical(input: {
  tenantId: string;
  claimPath: string;
  sourceRef: string;
  prevHash: string | null;
}): string {
  return JSON.stringify({
    claimPath: input.claimPath,
    prevHash: input.prevHash,
    sourceRef: input.sourceRef,
    tenantId: input.tenantId,
  });
}

function hashEntry(input: {
  tenantId: string;
  claimPath: string;
  sourceRef: string;
  prevHash: string | null;
}): string {
  return createHash("sha256").update(canonical(input), "utf8").digest("hex");
}

// A per-tenant 64-bit advisory lock key, derived from the tenantId, so concurrent
// appends for one tenant serialise and prevHash always references the true tail.
// Different tenants take different keys and never block each other.
function lockKey(tenantId: string): bigint {
  return createHash("sha256").update(tenantId, "utf8").digest().readBigInt64BE(0);
}

// Append one entry to a tenant's chain. The advisory lock is held for the
// transaction, so the tail read and the insert cannot interleave with another
// append for the same tenant.
export async function appendEntry(input: AppendEntryInput): Promise<ProvenanceLedgerEntry> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey(input.tenantId)})`);

    // The tail is the entry whose contentHash no other entry chains from. With
    // the advisory lock held there is exactly one, or none for a genesis append.
    const tail = await tx
      .select({ contentHash: provenanceLedgerTable.contentHash })
      .from(provenanceLedgerTable)
      .where(
        sql`${provenanceLedgerTable.tenantId} = ${input.tenantId} and not exists (
          select 1 from ${provenanceLedgerTable} as c
          where c.tenant_id = ${input.tenantId} and c.prev_hash = ${provenanceLedgerTable.contentHash}
        )`,
      )
      .limit(1);
    const prevHash = tail[0]?.contentHash ?? null;

    const contentHash = hashEntry({
      tenantId: input.tenantId,
      claimPath: input.claimPath,
      sourceRef: input.sourceRef,
      prevHash,
    });

    const inserted = await tx
      .insert(provenanceLedgerTable)
      .values({
        tenantId: input.tenantId,
        claimPath: input.claimPath,
        sourceRef: input.sourceRef,
        contentHash,
        prevHash,
      })
      .returning();
    return inserted[0]!;
  });
}

export interface VerifyResult {
  ok: boolean;
  length: number;
  brokenAt?: number;
  detail?: string;
}

// Re-walk a tenant's chain from its genesis (prevHash null), recomputing each
// contentHash from its stored fields and confirming each link. A flipped byte in
// any field changes the recomputed hash; a reorder or deletion breaks a link;
// either is reported with the first failing index. An empty chain verifies true.
export async function verifyChain(tenantId: string): Promise<VerifyResult> {
  const rows = await db
    .select()
    .from(provenanceLedgerTable)
    .where(eq(provenanceLedgerTable.tenantId, tenantId));
  const total = rows.length;
  if (total === 0) {
    return { ok: true, length: 0 };
  }

  const genesis = rows.filter((r) => r.prevHash === null);
  if (genesis.length !== 1) {
    return {
      ok: false,
      length: total,
      detail: "expected exactly one genesis entry, found " + genesis.length,
    };
  }

  // Index successors by the prevHash they chain from; a fork (two entries from
  // the same prevHash) is itself a corruption.
  const byPrevHash = new Map<string, ProvenanceLedgerEntry>();
  for (const r of rows) {
    if (r.prevHash !== null) {
      if (byPrevHash.has(r.prevHash)) {
        return { ok: false, length: total, detail: "fork detected from a shared prevHash" };
      }
      byPrevHash.set(r.prevHash, r);
    }
  }

  let current: ProvenanceLedgerEntry | undefined = genesis[0];
  let prevHash: string | null = null;
  let index = 0;
  const seen = new Set<string>();
  while (current) {
    if (current.prevHash !== prevHash) {
      return { ok: false, length: total, brokenAt: index, detail: "prevHash link mismatch" };
    }
    const expected = hashEntry({
      tenantId,
      claimPath: current.claimPath ?? "",
      sourceRef: current.sourceRef ?? "",
      prevHash,
    });
    if (current.contentHash !== expected) {
      return {
        ok: false,
        length: total,
        brokenAt: index,
        detail: "content hash mismatch (tampered entry)",
      };
    }
    if (seen.has(current.id)) {
      return { ok: false, length: total, brokenAt: index, detail: "cycle detected" };
    }
    seen.add(current.id);
    prevHash = current.contentHash;
    current = byPrevHash.get(current.contentHash);
    index++;
  }

  if (seen.size !== total) {
    return {
      ok: false,
      length: total,
      detail: "unreachable entries: walked " + seen.size + " of " + total,
    };
  }
  return { ok: true, length: total };
}
