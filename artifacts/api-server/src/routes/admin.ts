import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import {
  db,
  invitePinsTable,
  orgsTable,
  orgTenantsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { mintInvitePin } from "../lib/auth/inviteMinting";
import { pinState } from "../lib/auth/pin";
import { logger } from "../lib/logger";

// The owner Access console API. requireAuth and requireOwner are applied where
// this router is mounted, so every handler here can assume an owner caller.
export const adminRouter: Router = Router();

// Roles an owner may mint a PIN for. provider-owner is deliberately excluded:
// the single owner is bootstrapped, never minted, so a PIN can never escalate
// to owner.
const MINTABLE_ROLES = ["provider-member", "client-admin", "client-viewer"] as const;

const createPinSchema = z.object({
  label: z.string().max(200).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  scopeOrgId: z.string().uuid().optional(),
  scopeRole: z.enum(MINTABLE_ROLES).optional(),
});

const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["client", "portfolio"]),
});

const bindTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

// Mint a PIN. The plaintext code is returned exactly once, here, and never
// again: only its keyed hash is stored. The owner copies it now or mints a new
// one.
adminRouter.post("/pins", async (req, res, next) => {
  const parsed = createPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const owner = req.user;
  if (!owner) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  const { label, scopeRole } = parsed.data;
  const maxUses = parsed.data.maxUses ?? 1;
  const expiresInDays = parsed.data.expiresInDays ?? 14;
  let scopeOrgId = parsed.data.scopeOrgId ?? null;

  // A client role must be scoped to a client or portfolio org, otherwise the
  // user would land nowhere and see nothing. A provider-member PIN may be
  // unscoped (it resolves to the provider org at registration).
  if (scopeRole === "client-admin" || scopeRole === "client-viewer") {
    if (!scopeOrgId) {
      res.status(400).json({ error: "scope_org_required" });
      return;
    }
  }
  if (scopeOrgId) {
    const org = (await db.select().from(orgsTable).where(eq(orgsTable.id, scopeOrgId)).limit(1))[0];
    if (!org) {
      res.status(400).json({ error: "scope_org_not_found" });
      return;
    }
    if (org.type === "provider") {
      res.status(400).json({ error: "scope_org_invalid" });
      return;
    }
  } else {
    scopeOrgId = null;
  }

  try {
    const minted = await mintInvitePin({
      label: label ?? null,
      maxUses,
      expiresInDays,
      scopeOrgId,
      scopeRole: scopeRole ?? null,
      createdBy: owner.id,
    });
    logger.info({ pinId: minted.id, createdBy: owner.id }, "invite pin minted");
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

adminRouter.get("/pins", async (_req, res, next) => {
  try {
    const rows = await db.select().from(invitePinsTable).orderBy(desc(invitePinsTable.createdAt));
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

adminRouter.post("/pins/:id/revoke", async (req, res, next) => {
  try {
    const revoked = await db
      .update(invitePinsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitePinsTable.id, req.params.id), isNull(invitePinsTable.revokedAt)))
      .returning({ id: invitePinsTable.id });
    if (revoked.length === 0) {
      // Either the PIN does not exist or it was already revoked. Report the
      // current state without failing loudly on a double revoke.
      const exists = (
        await db.select({ id: invitePinsTable.id }).from(invitePinsTable).where(eq(invitePinsTable.id, req.params.id)).limit(1)
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

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        displayName: usersTable.displayName,
        role: usersTable.role,
        status: usersTable.status,
        orgId: usersTable.orgId,
        orgName: orgsTable.name,
        createdAt: usersTable.createdAt,
        lastLoginAt: usersTable.lastLoginAt,
      })
      .from(usersTable)
      .leftJoin(orgsTable, eq(usersTable.orgId, orgsTable.id))
      .orderBy(desc(usersTable.createdAt));
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// Disable an account. Two invariants protect the platform from being locked
// out: an owner cannot disable their own account, and the last active
// provider-owner cannot be disabled.
adminRouter.post("/users/:id/disable", async (req, res, next) => {
  const owner = req.user;
  if (!owner) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (req.params.id === owner.id) {
    res.status(400).json({ error: "cannot_disable_self" });
    return;
  }
  try {
    const target = (
      await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1)
    )[0];
    if (!target) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (target.role === "provider-owner") {
      const otherActiveOwners = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "provider-owner"),
            eq(usersTable.status, "active"),
            ne(usersTable.id, target.id),
          ),
        )
        .limit(1);
      if (otherActiveOwners.length === 0) {
        res.status(400).json({ error: "cannot_disable_last_owner" });
        return;
      }
    }
    await db.update(usersTable).set({ status: "disabled" }).where(eq(usersTable.id, target.id));
    logger.info({ userId: target.id, by: owner.id }, "user disabled");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Re-enable a previously disabled account. The natural inverse of disable, so a
// mistaken disable is recoverable rather than permanent. Logged as an addition
// in the drift report.
adminRouter.post("/users/:id/enable", async (req, res, next) => {
  try {
    const updated = await db
      .update(usersTable)
      .set({ status: "active" })
      .where(eq(usersTable.id, req.params.id))
      .returning({ id: usersTable.id });
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/orgs", async (_req, res, next) => {
  try {
    const orgs = await db.select().from(orgsTable).orderBy(desc(orgsTable.createdAt));
    const bindings = await db
      .select({
        orgId: orgTenantsTable.orgId,
        tenantId: tenantsTable.id,
        tenantName: tenantsTable.name,
      })
      .from(orgTenantsTable)
      .innerJoin(tenantsTable, eq(orgTenantsTable.tenantId, tenantsTable.id));

    const byOrg = new Map<string, { id: string; name: string }[]>();
    for (const b of bindings) {
      const list = byOrg.get(b.orgId) ?? [];
      list.push({ id: b.tenantId, name: b.tenantName });
      byOrg.set(b.orgId, list);
    }

    res.json({
      orgs: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        createdAt: o.createdAt,
        tenants: byOrg.get(o.id) ?? [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/orgs", async (req, res, next) => {
  const parsed = createOrgSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const inserted = await db
      .insert(orgsTable)
      .values({ name: parsed.data.name, type: parsed.data.type })
      .returning();
    res.status(201).json({ org: inserted[0] });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/orgs/:id/tenants", async (req, res, next) => {
  const parsed = bindTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const org = (await db.select().from(orgsTable).where(eq(orgsTable.id, req.params.id)).limit(1))[0];
    if (!org) {
      res.status(404).json({ error: "org_not_found" });
      return;
    }
    if (org.type === "provider") {
      // The provider org sees all tenants by role and needs no bindings.
      res.status(400).json({ error: "provider_org_needs_no_bindings" });
      return;
    }
    const tenant = (
      await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, parsed.data.tenantId)).limit(1)
    )[0];
    if (!tenant) {
      res.status(404).json({ error: "tenant_not_found" });
      return;
    }
    await db
      .insert(orgTenantsTable)
      .values({ orgId: org.id, tenantId: tenant.id })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// A flat tenant list for the binding picker in the console. Owner-only by mount.
adminRouter.get("/tenants", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.name,
        url: tenantsTable.url,
        status: tenantsTable.status,
      })
      .from(tenantsTable)
      .orderBy(desc(tenantsTable.createdAt));
    res.json({ tenants: rows });
  } catch (err) {
    next(err);
  }
});
