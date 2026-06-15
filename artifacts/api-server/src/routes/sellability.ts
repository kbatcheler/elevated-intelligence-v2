import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { isProvider } from "../lib/auth/access";
import { requireTenantAccess } from "../middleware/auth";
import {
  listShareTokens,
  mintShareToken,
  revokeShareToken,
} from "../lib/sellability/shareTokens";
import { loadCaseStudies } from "../lib/sellability/caseStudies";

// Sellability Pack (Phase AB), authed surface. Mounted under the shared session
// gate. Minting and revoking a shareable diagnosis, listing the shares, and
// reading the anonymized case studies are provider-side selling actions, so every
// route requires a provider seat (owner or member) on top of per-tenant access.
export const sellabilityRouter: Router = Router();

// Provider-only gate. Runs after requireAuth (mounted upstream) and, on the
// tenant routes, after requireTenantAccess. A client or portfolio seat is never
// the one selling the diagnosis, so it is refused here.
function requireProvider(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(req.user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

const mintSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  expiresInDays: z.number().int().positive().optional(),
});

// Mint a read-only shareable diagnosis link for a tenant. The opaque token is
// returned exactly once here; it is never readable again from any list.
sellabilityRouter.post(
  "/tenants/:id/share-tokens",
  requireTenantAccess,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = mintSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
        return;
      }
      const tenantId = String(req.params.id);
      const minted = await mintShareToken({
        tenantId,
        createdBy: req.user?.id ?? null,
        label: parsed.data.label ?? null,
        expiresInDays: parsed.data.expiresInDays ?? null,
      });
      res.status(201).json({ share: minted });
    } catch (err) {
      next(err);
    }
  },
);

// List a tenant's shares as metadata only: never the token, never the hash.
sellabilityRouter.get(
  "/tenants/:id/share-tokens",
  requireTenantAccess,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = String(req.params.id);
      res.json({ shares: await listShareTokens(tenantId) });
    } catch (err) {
      next(err);
    }
  },
);

// Revoke a share early. Idempotent: revoking an already-revoked link succeeds.
sellabilityRouter.post(
  "/tenants/:id/share-tokens/:tokenId/revoke",
  requireTenantAccess,
  requireProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = String(req.params.id);
      const tokenId = String(req.params.tokenId);
      const result = await revokeShareToken(tenantId, tokenId);
      if (!result) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ revoked: result });
    } catch (err) {
      next(err);
    }
  },
);

// The anonymized, segment-level case studies (k-anonymity and noise applied).
// Provider-only: it is a cross-cohort selling asset, never a client surface.
sellabilityRouter.get(
  "/case-studies",
  requireProvider,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ caseStudies: await loadCaseStudies() });
    } catch (err) {
      next(err);
    }
  },
);
