import { eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { z } from "zod";
import { db, tenantsTable, usersTable } from "@workspace/db";
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
import { getKmsRuntime } from "../lib/security/kms";
import { readDecryptedSignalsForHuman } from "../lib/security/signalRead";
import {
  ensureActiveTenantKey,
  getTenantKey,
  revokeTenantKey,
} from "../lib/security/tenantKeyService";
import { verifyChain } from "../lib/provenance/ledger";
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
    });
  } catch (err) {
    next(err);
  }
});

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
      const result = await verifyChain(String(req.params.id));
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── Break-glass human signal read (any role, active grant required) ───────────
// requireTenantAccess fences the tenant for the seat; the grant check is the
// additional gate that binds EVERY role, the owner included. No standing access.

securityRouter.get(
  "/security/tenants/:id/signals",
  requireTenantAccess,
  async (req, res, next) => {
    const tenantId = String(req.params.id);
    const user = req.user!;
    try {
      const grant = await requireActiveBreakGlassGrant(user.id, tenantId);
      const signals = await readDecryptedSignalsForHuman(tenantId);
      await logSignalAccess(grant.id, user.id, tenantId, "read_signals", "count=" + signals.length);
      res.json({ tenantId, signals });
    } catch (err) {
      if (!mapError(err, res)) next(err);
    }
  },
);
