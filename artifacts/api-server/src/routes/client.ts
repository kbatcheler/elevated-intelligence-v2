import type { UserRole } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db, invitePinsTable, orgsTable } from "@workspace/db";
import { mintInvitePin } from "../lib/auth/inviteMinting";
import { pinState } from "../lib/auth/pin";
import { logger } from "../lib/logger";

// The client-admin onboarding surface. requireAuth is applied where this router
// is mounted; the router-level guard below restricts every route to the
// client-admin role and to a caller that actually belongs to an org. A
// client-admin onboards client-viewers into THEIR OWN org and nowhere else: the
// scope is forced server-side (the caller's own orgId, the client-viewer role),
// never taken from the request body, so this surface can never reach the
// provider side or another org no matter what is posted to it.
export const clientRouter: Router = Router();

const VIEWER_ROLE: UserRole = "client-viewer";

clientRouter.use((req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (user.role !== "client-admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!user.orgId) {
    // A client-admin with no org can onboard no one. Fail honestly rather than
    // minting an unscoped PIN that would land its holder nowhere.
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
});

// scopeOrgId and scopeRole are accepted ONLY so a widening attempt can be
// rejected explicitly rather than silently overridden. The effective scope is
// always forced to the caller's own org and the client-viewer role below.
const createViewerPinSchema = z.object({
  label: z.string().max(200).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  scopeOrgId: z.string().uuid().optional(),
  scopeRole: z.string().optional(),
});

clientRouter.post("/viewer-pins", async (req, res, next) => {
  const parsed = createViewerPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const user = req.user!;
  const orgId = user.orgId!;

  // Reject a scope-widening attempt loudly instead of quietly overriding it, so
  // a client-admin cannot probe for a way past their own org or role.
  if (parsed.data.scopeRole !== undefined && parsed.data.scopeRole !== VIEWER_ROLE) {
    res.status(400).json({ error: "scope_role_forbidden" });
    return;
  }
  if (parsed.data.scopeOrgId !== undefined && parsed.data.scopeOrgId !== orgId) {
    res.status(400).json({ error: "scope_org_forbidden" });
    return;
  }

  const maxUses = parsed.data.maxUses ?? 1;
  const expiresInDays = parsed.data.expiresInDays ?? 14;

  try {
    // The caller's org must still exist and must not be a provider org. Only
    // client-admins reach this router, so this can never be a provider org in
    // practice, but verify rather than assume.
    const org = (await db.select().from(orgsTable).where(eq(orgsTable.id, orgId)).limit(1))[0];
    if (!org || org.type === "provider") {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const minted = await mintInvitePin({
      label: parsed.data.label ?? null,
      maxUses,
      expiresInDays,
      scopeOrgId: orgId,
      scopeRole: VIEWER_ROLE,
      createdBy: user.id,
    });
    logger.info({ pinId: minted.id, orgId, createdBy: user.id }, "client-admin minted viewer pin");
    res.status(201).json({
      pin: {
        id: minted.id,
        code: minted.code, // shown once, never stored or returned again
        label: minted.label,
        maxUses: minted.maxUses,
        useCount: minted.useCount,
        expiresAt: minted.expiresAt,
        scopeOrgId: minted.scopeOrgId,
        scopeRole: minted.scopeRole,
        createdAt: minted.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

clientRouter.get("/viewer-pins", async (req, res, next) => {
  const user = req.user!;
  const orgId = user.orgId!;
  try {
    // Scoped to the caller's own org AND the viewer role: a client-admin sees the
    // viewer invites for their org and nothing else (not provider PINs, not
    // another org's invites).
    const rows = await db
      .select()
      .from(invitePinsTable)
      .where(and(eq(invitePinsTable.scopeOrgId, orgId), eq(invitePinsTable.scopeRole, VIEWER_ROLE)))
      .orderBy(desc(invitePinsTable.createdAt));
    const now = new Date();
    res.json({
      pins: rows.map((p) => ({
        id: p.id,
        label: p.label,
        maxUses: p.maxUses,
        useCount: p.useCount,
        expiresAt: p.expiresAt,
        revokedAt: p.revokedAt,
        scopeOrgId: p.scopeOrgId,
        scopeRole: p.scopeRole,
        createdAt: p.createdAt,
        state: pinState(p, now),
      })),
    });
  } catch (err) {
    next(err);
  }
});

clientRouter.post("/viewer-pins/:id/revoke", async (req, res, next) => {
  const user = req.user!;
  const orgId = user.orgId!;
  try {
    // The revoke is scoped to the caller's own org and the viewer role, so a
    // client-admin can only ever revoke a PIN they are allowed to see.
    const revoked = await db
      .update(invitePinsTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitePinsTable.id, req.params.id),
          eq(invitePinsTable.scopeOrgId, orgId),
          eq(invitePinsTable.scopeRole, VIEWER_ROLE),
          isNull(invitePinsTable.revokedAt),
        ),
      )
      .returning({ id: invitePinsTable.id });
    if (revoked.length === 0) {
      // Either it is not a viewer PIN in this admin's org (a genuine miss) or it
      // was already revoked (an idempotent double-revoke). Distinguish the two.
      const exists = (
        await db
          .select({ id: invitePinsTable.id })
          .from(invitePinsTable)
          .where(
            and(
              eq(invitePinsTable.id, req.params.id),
              eq(invitePinsTable.scopeOrgId, orgId),
              eq(invitePinsTable.scopeRole, VIEWER_ROLE),
            ),
          )
          .limit(1)
      )[0];
      if (!exists) {
        res.status(404).json({ error: "not_found" });
        return;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
