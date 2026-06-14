import { eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { z } from "zod";
import { getDescriptor } from "@workspace/connectors";
import { db, tenantConnectionsTable, tenantsTable, usersTable } from "@workspace/db";
import { getAlerter } from "../lib/alerts/alerter";
import { deriveConnectionHealth } from "../lib/connectors/connectionHealth";
import { logger } from "../lib/logger";
import {
  createBreakGlassGrant,
  listAccessEvents,
  listGrants,
  logSignalAccess,
  requireActiveBreakGlassGrant,
  revokeBreakGlassGrant,
} from "../lib/security/breakGlass";
import { BreakGlassRequiredError, CryptoShreddedError, SignalEncryptionError } from "../lib/security/errors";
import { customerKmsStatus, getKmsRuntime } from "../lib/security/kms";
import { readDecryptedSignalsForHuman } from "../lib/security/signalRead";
import {
  ensureActiveTenantKey,
  getTenantKey,
  revokeTenantKey,
} from "../lib/security/tenantKeyService";
import { verifyChain } from "../lib/provenance/ledger";
import { isProvider } from "../lib/auth/access";
import { requireOwner, requireTenantAccess } from "../middleware/auth";

// The Tier 3 security surface (Phase K, backend only; the portal UI is Phase L).
// Two trust levels: owner-only key and grant administration, and the break-glass
// human signal read that EVERY role (owner included) may reach only under an
// active grant. requireAuth is applied at the /api mount; per-route gates follow.
export const securityRouter: Router = Router();

// Map the typed crypto and break-glass failures to honest status codes. Returns
// true when it handled the error, so the caller can fall through to next(err) for
// anything unexpected rather than masking a real fault.
function mapError(err: unknown, res: Response): boolean {
  if (err instanceof BreakGlassRequiredError) {
    res.status(403).json({ error: "break_glass_required", detail: err.message });
    return true;
  }
  if (err instanceof CryptoShreddedError) {
    res.status(409).json({ error: "crypto_shredded", detail: err.message });
    return true;
  }
  if (err instanceof SignalEncryptionError) {
    res.status(422).json({ error: "signal_unreadable", detail: err.message });
    return true;
  }
  return false;
}

async function tenantExists(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return rows.length > 0;
}

// ── Tenant key lifecycle (owner only) ────────────────────────────────────────

securityRouter.get("/security/tenants/:id/key", requireOwner, async (req, res, next) => {
  const tenantId = String(req.params.id);
  try {
    if (!(await tenantExists(tenantId))) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const key = await getTenantKey(tenantId);
    res.json({
      tenantId,
      provisioned: key !== null,
      status: key?.status ?? "none",
      revokedAt: key?.revokedAt ?? null,
      kms: getKmsRuntime().status(),
      // The declared customer-managed KMS seam and its honest connection state, so
      // the posture view can show "available, not connected" without inventing it.
      customerKms: customerKmsStatus(),
    });
  } catch (err) {
    next(err);
  }
});

// ── Connector health (owner only, Phase O) ───────────────────────────────────
// Health is derived at read time from each connection's real last-success and
// last-error timestamps and the connector's staleness threshold; it is never
// stored, so it cannot drift from reality, and a connection that has never run
// reads as degraded rather than healthy. Rows are ordered worst-first so an
// operator sees errors before healthy connections.
securityRouter.get(
  "/security/tenants/:id/connector-health",
  requireOwner,
  async (req, res, next) => {
    const tenantId = String(req.params.id);
    try {
      if (!(await tenantExists(tenantId))) {
        res.status(404).json({ error: "tenant_not_found" });
        return;
      }
      const rows = await db
        .select()
        .from(tenantConnectionsTable)
        .where(eq(tenantConnectionsTable.tenantId, tenantId));
      const now = new Date();
      const connections = rows.map((c) => {
        const descriptor = getDescriptor(c.connectorKey);
        const stalenessThresholdSeconds =
          descriptor?.stalenessThresholdSeconds ?? 24 * 60 * 60;
        return {
          connectorKey: c.connectorKey,
          name: descriptor?.name ?? c.connectorKey,
          deployment: descriptor?.deployment ?? null,
          status: c.status,
          health: deriveConnectionHealth({
            status: c.status,
            lastSuccessAt: c.lastSuccessAt,
            lastErrorAt: c.lastErrorAt,
            stalenessThresholdSeconds,
            now,
          }),
          lastSuccessAt: c.lastSuccessAt,
          lastRunAt: c.lastRunAt,
          lastErrorAt: c.lastErrorAt,
          lastErrorCode: c.lastErrorCode,
          lastErrorMessage: c.lastErrorMessage,
          stalenessThresholdSeconds,
        };
      });
      const rank: Record<string, number> = { error: 0, degraded: 1, healthy: 2 };
      connections.sort(
        (a, b) => (rank[a.health] ?? 9) - (rank[b.health] ?? 9) || a.name.localeCompare(b.name),
      );
      res.json({ tenantId, connections });
    } catch (err) {
      next(err);
    }
  },
);

securityRouter.post(
  "/security/tenants/:id/key/provision",
  requireOwner,
  async (req, res, next) => {
    const tenantId = String(req.params.id);
    try {
      if (!(await tenantExists(tenantId))) {
        res.status(404).json({ error: "tenant_not_found" });
        return;
      }
      await ensureActiveTenantKey(tenantId);
      const key = await getTenantKey(tenantId);
      logger.info({ tenantId, by: req.user?.id }, "tenant key provisioned");
      res.status(201).json({ tenantId, status: key?.status ?? "active" });
    } catch (err) {
      if (!mapError(err, res)) next(err);
    }
  },
);

securityRouter.post("/security/tenants/:id/key/revoke", requireOwner, async (req, res, next) => {
  const tenantId = String(req.params.id);
  try {
    const result = await revokeTenantKey(tenantId);
    logger.info({ tenantId, by: req.user?.id }, "tenant key revoked (crypto-shred)");
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("no key to revoke")) {
      res.status(404).json({ error: "no_key_to_revoke" });
      return;
    }
    if (!mapError(err, res)) next(err);
  }
});

// ── Break-glass grant administration (owner only) ────────────────────────────

const createGrantSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  expiresInMinutes: z.number().int().min(1).max(1440),
});

securityRouter.post("/security/tenants/:id/grants", requireOwner, async (req, res, next) => {
  const tenantId = String(req.params.id);
  const parsed = createGrantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    if (!(await tenantExists(tenantId))) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    const target = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, parsed.data.userId))
      .limit(1);
    if (target.length === 0) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    const grant = await createBreakGlassGrant({
      userId: parsed.data.userId,
      tenantId,
      grantedBy: req.user!.id,
      reason: parsed.data.reason,
      expiresInMinutes: parsed.data.expiresInMinutes,
    });
    logger.info(
      { tenantId, userId: parsed.data.userId, grantId: grant.id, by: req.user?.id },
      "break-glass grant created",
    );
    res.status(201).json({
      grant: {
        id: grant.id,
        userId: grant.userId,
        tenantId: grant.tenantId,
        reason: grant.reason,
        grantedAt: grant.grantedAt,
        expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

securityRouter.get("/security/tenants/:id/grants", requireOwner, async (req, res, next) => {
  try {
    const grants = await listGrants(String(req.params.id));
    res.json({ grants });
  } catch (err) {
    next(err);
  }
});

securityRouter.post("/security/grants/:grantId/revoke", requireOwner, async (req, res, next) => {
  try {
    const revoked = await revokeBreakGlassGrant(String(req.params.grantId));
    logger.info({ grantId: String(req.params.grantId), by: req.user?.id, revoked }, "break-glass grant revoke");
    res.json({ ok: true, revoked });
  } catch (err) {
    next(err);
  }
});

securityRouter.get(
  "/security/tenants/:id/access-events",
  requireOwner,
  async (req, res, next) => {
    try {
      const events = await listAccessEvents(String(req.params.id));
      res.json({ events });
    } catch (err) {
      next(err);
    }
  },
);

// ── Provenance verification (owner only) ─────────────────────────────────────

securityRouter.get(
  "/security/tenants/:id/provenance/verify",
  requireOwner,
  async (req, res, next) => {
    try {
      const tenantId = String(req.params.id);
      const result = await verifyChain(tenantId);
      if (!result.ok) {
        // Phase P: a broken provenance chain is a critical integrity event an
        // operator must see. Best-effort emit; never let an alert failure mask
        // the verify result the owner is asking for.
        try {
          await getAlerter().emit({
            type: "provenance_integrity_failed",
            severity: "critical",
            tenantId,
            entityType: "provenance_chain",
            entityId: result.brokenAt === undefined ? null : String(result.brokenAt),
            message: "provenance chain verification failed for tenant " + tenantId,
            details: {
              brokenAt: result.brokenAt === undefined ? null : result.brokenAt,
              detail: result.detail ?? null,
              length: result.length,
            },
          });
        } catch (alertErr) {
          logger.error(
            { err: alertErr instanceof Error ? alertErr.message : String(alertErr) },
            "provenance_integrity_failed alert emit failed",
          );
        }
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── Break-glass human signal read (provider roles only, active grant required) ─
// requireTenantAccess fences the tenant for the seat; the grant check is the
// additional gate that binds EVERY provider role, the owner included. No
// standing access. Phase T: a tenant's raw decrypted signals are the closest
// thing to its source data, which the client onboarding boundary fences off from
// client seats, so break-glass stays a provider-side incident tool. A client
// role is refused here even when bound to the tenant and even under a grant.

securityRouter.get(
  "/security/tenants/:id/signals",
  requireTenantAccess,
  async (req, res, next) => {
    const tenantId = String(req.params.id);
    const user = req.user!;
    if (!isProvider(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      const grant = await requireActiveBreakGlassGrant(user.id, tenantId);
      const signals = await readDecryptedSignalsForHuman(tenantId);
      await logSignalAccess(grant.id, user.id, tenantId, "read_signals", "count=" + signals.length);
      // Phase P: a human standing in a tenant's raw signal data is an event an
      // operator must see. Best-effort emit; no signal values, only a count.
      try {
        await getAlerter().emit({
          type: "break_glass_used",
          severity: "warning",
          tenantId,
          entityType: "access_grant",
          entityId: grant.id,
          message: "break-glass signal read by user " + user.id + " on tenant " + tenantId,
          details: { userId: user.id, action: "read_signals", count: signals.length },
        });
      } catch (alertErr) {
        logger.error(
          { err: alertErr instanceof Error ? alertErr.message : String(alertErr) },
          "break_glass_used alert emit failed",
        );
      }
      res.json({ tenantId, signals });
    } catch (err) {
      if (!mapError(err, res)) next(err);
    }
  },
);
