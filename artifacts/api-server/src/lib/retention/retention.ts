import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db, derivedSignalsTable, retentionEventsTable } from "@workspace/db";
import { appendEntryTx } from "../provenance/ledger";

// Retention and deletion (Phase S). Derived signals are ephemeral by design:
// each refresh supersedes the prior set and resets its computedAt, so a signal
// "not refreshed within the TTL" is simply one whose computedAt has fallen
// behind the cutoff. Two paths live here:
//
//   - a scheduled TTL purge that removes signals older than the configured age
//     and records one audit row per affected tenant, and
//   - an operator-authorized tenant erasure that deletes a tenant's signals,
//     appends an append-only provenance redaction (never deleting ledger rows,
//     so the hash chain still verifies), and records an audit row.
//
// Both write a retention_events row capturing what, when, and on whose
// authority. Neither fabricates an audit row when nothing was actually deleted.

// A minimal log sink, matching the server logger and the connector maintenance
// logger structurally so this module composes with either.
export interface RetentionLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_DAYS = 90;
const DEFAULT_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Parse a positive number from an env value, falling back when unset or invalid.
// Mirrors the budget and db-pool env parsing so configuration behaves uniformly.
function numEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// The configured signal time-to-live in days. Default documented in replit.md.
export function getRetentionTtlDays(): number {
  return numEnv(process.env.RETENTION_TTL_DAYS, DEFAULT_TTL_DAYS);
}

export interface RetentionPurgeDeps {
  now: Date;
  ttlDays: number;
  log: RetentionLogger;
}

export interface RetentionPurgeOutcome {
  cutoff: Date;
  ttlDays: number;
  deletedCount: number;
  perTenant: { tenantId: string; count: number }[];
  auditRowIds: string[];
}

// Delete every derived signal computed before the TTL cutoff, in one
// transaction, and write one ttl_purge audit row per tenant that actually lost
// rows. A tick that deletes nothing writes no audit row and logs nothing, so the
// audit never fills with empty sweeps. Free of any timer: the caller supplies
// the clock and the TTL, so it is exercised directly in tests and the interval
// is started only from the server entrypoint.
export async function runRetentionPurge(deps: RetentionPurgeDeps): Promise<RetentionPurgeOutcome> {
  const cutoff = new Date(deps.now.getTime() - deps.ttlDays * DAY_MS);

  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(derivedSignalsTable)
      .where(lt(derivedSignalsTable.computedAt, cutoff))
      .returning({ id: derivedSignalsTable.id, tenantId: derivedSignalsTable.tenantId });

    const perTenantMap = new Map<string, number>();
    for (const row of deleted) {
      perTenantMap.set(row.tenantId, (perTenantMap.get(row.tenantId) ?? 0) + 1);
    }
    const perTenant = [...perTenantMap.entries()].map(([tenantId, count]) => ({ tenantId, count }));

    const auditRowIds: string[] = [];
    for (const { tenantId, count } of perTenant) {
      const inserted = await tx
        .insert(retentionEventsTable)
        .values({
          tenantId,
          action: "ttl_purge",
          authorityUserId: null,
          authorityRole: "system",
          scope: { ttlDays: deps.ttlDays, cutoff: cutoff.toISOString() },
          deletedDerivedSignalCount: count,
          redactionLedgerEntryId: null,
          reason: "scheduled ttl purge",
        })
        .returning({ id: retentionEventsTable.id });
      auditRowIds.push(inserted[0]!.id);
    }

    if (deleted.length > 0) {
      deps.log.info(
        {
          deletedCount: deleted.length,
          tenants: perTenant.length,
          ttlDays: deps.ttlDays,
          cutoff: cutoff.toISOString(),
        },
        "retention ttl purge",
      );
    }

    return {
      cutoff,
      ttlDays: deps.ttlDays,
      deletedCount: deleted.length,
      perTenant,
      auditRowIds,
    };
  });
}

// A deterministic digest over exactly the signals an erasure removed: the sorted
// erased ids and provenance refs, the count, and the scope. Anchored under the
// redaction ledger entry's sourceRef so the append-only record names precisely
// what was redacted without storing any signal value.
function redactionDigest(input: {
  tenantId: string;
  scope: string;
  erasedIds: string[];
  provenanceRefs: (string | null)[];
  count: number;
}): string {
  const canonical = JSON.stringify({
    count: input.count,
    erasedIds: [...input.erasedIds].sort(),
    provenanceRefs: [...input.provenanceRefs.map((r) => r ?? "")].sort(),
    scope: input.scope,
    tenantId: input.tenantId,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface EraseTenantArgs {
  tenantId: string;
  authority: { userId: string | null; role: string };
  reason?: string;
}

export interface EraseTenantResult {
  tenantId: string;
  deletedCount: number;
  redactionLedgerEntryId: string;
  redactionSourceRef: string;
  auditRowId: string;
}

// Erase a tenant's derived signals. In one transaction: delete the signals
// (capturing exactly which rows, by id and provenanceRef), append a provenance
// redaction entry naming that set by digest (the ledger is never mutated or
// trimmed, so verifyChain still passes), and write a tenant_erasure audit row
// linking to the redaction. Atomic: any failure rolls the whole thing back, so
// signals are never deleted without their redaction and audit. Erasing a tenant
// with no signals still appends a redaction (count 0) and audits the action, so
// the request to forget is itself recorded.
export async function eraseTenantDerivedSignals(args: EraseTenantArgs): Promise<EraseTenantResult> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, args.tenantId))
      .returning({
        id: derivedSignalsTable.id,
        provenanceRef: derivedSignalsTable.provenanceRef,
      });

    const digest = redactionDigest({
      tenantId: args.tenantId,
      scope: "tenant",
      erasedIds: deleted.map((d) => d.id),
      provenanceRefs: deleted.map((d) => d.provenanceRef),
      count: deleted.length,
    });
    const sourceRef = "sha256:" + digest;

    const entry = await appendEntryTx(tx, {
      tenantId: args.tenantId,
      claimPath: "redaction:derived_signals:tenant",
      sourceRef,
    });

    const inserted = await tx
      .insert(retentionEventsTable)
      .values({
        tenantId: args.tenantId,
        action: "tenant_erasure",
        authorityUserId: args.authority.userId,
        authorityRole: args.authority.role,
        scope: { scope: "tenant", count: deleted.length },
        deletedDerivedSignalCount: deleted.length,
        redactionLedgerEntryId: entry.id,
        reason: args.reason ?? null,
      })
      .returning({ id: retentionEventsTable.id });

    return {
      tenantId: args.tenantId,
      deletedCount: deleted.length,
      redactionLedgerEntryId: entry.id,
      redactionSourceRef: sourceRef,
      auditRowId: inserted[0]!.id,
    };
  });
}

export interface RetentionSchedulerHandle {
  stop(): void;
}

// Start the in-process retention purge loop. Called ONLY from the server
// entrypoint, never from app.ts, so importing the app in a test never starts a
// timer. Each tick purges signals past the TTL; a tick failure is logged and
// never crashes the loop. Ticks never overlap, and the timer is unref'd so it
// does not keep the process alive on its own.
export function startRetentionPurge(
  log: RetentionLogger,
  options: { intervalMs?: number; ttlDays?: number } = {},
): RetentionSchedulerHandle {
  const intervalMs =
    options.intervalMs ?? numEnv(process.env.RETENTION_PURGE_INTERVAL_MS, DEFAULT_PURGE_INTERVAL_MS);
  const ttlDays = options.ttlDays ?? getRetentionTtlDays();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await runRetentionPurge({ now: new Date(), ttlDays, log });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "retention purge tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
