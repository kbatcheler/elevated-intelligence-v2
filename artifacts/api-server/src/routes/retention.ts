import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db, retentionEventsTable, tenantsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { eraseTenantDerivedSignals } from "../lib/retention/retention";
import { requireOwner } from "../middleware/auth";

// The retention and deletion surface (Phase S). Erasure is a destructive,
// provider-side action, so it is owner-only; requireAuth is applied at the /api
// mount and requireOwner gates each route here. Every erasure is recorded as a
// retention_events audit row with the authorizing owner, and the scheduled TTL
// purge (started only from the entrypoint) writes its own audit rows.
export const retentionRouter: Router = Router();

// Token-scoped erasure is deliberately unsupported: derived_signals are
// aggregate math (a number or numeric vector per layer), with no identity thread
// and no per-token row to remove. A tokenRef in the body is rejected loudly
// rather than silently widened to a full tenant erasure. Unknown keys are
// rejected too, so a malformed request cannot smuggle an unintended scope.
const eraseBodySchema = z
  .object({
    tokenRef: z.string().min(1).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

async function tenantExists(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return rows.length > 0;
}

// Erase a tenant's derived signals, append an append-only provenance redaction,
// and audit the action under the owner who authorized it.
retentionRouter.delete(
  "/retention/tenants/:id/derived-signals",
  requireOwner,
  async (req, res, next) => {
    const tenantId = String(req.params.id);
    try {
      const parsed = eraseBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_request", detail: parsed.error.message });
        return;
      }
      if (parsed.data.tokenRef) {
        res.status(400).json({
          error: "token_erasure_not_supported_for_aggregate_signals",
          detail:
            "derived_signals are aggregate math with no identity thread; only tenant-scoped erasure is supported",
        });
        return;
      }
      if (!(await tenantExists(tenantId))) {
        res.status(404).json({ error: "tenant_not_found" });
        return;
      }

      const user = req.user!;
      const result = await eraseTenantDerivedSignals({
        tenantId,
        authority: { userId: user.id, role: user.role },
        reason: parsed.data.reason,
      });

      logger.info(
        {
          tenantId,
          deletedCount: result.deletedCount,
          redactionLedgerEntryId: result.redactionLedgerEntryId,
          authorityUserId: user.id,
          authorityRole: user.role,
        },
        "tenant derived-signal erasure",
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Read a tenant's retention audit history (owner only).
retentionRouter.get("/retention/tenants/:id/events", requireOwner, async (req, res, next) => {
  const tenantId = String(req.params.id);
  try {
    if (!(await tenantExists(tenantId))) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const events = await db
      .select()
      .from(retentionEventsTable)
      .where(eq(retentionEventsTable.tenantId, tenantId))
      .orderBy(desc(retentionEventsTable.createdAt));
    res.json({ tenantId, events });
  } catch (err) {
    next(err);
  }
});
