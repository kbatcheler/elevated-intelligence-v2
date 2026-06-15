import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  db,
  orgsTable,
  orgTenantsTable,
  usersTable,
  type OrgType,
  type User,
  type UserRole,
} from "@workspace/db";
import { canAccessTenant, isOwner, isProvider } from "../lib/auth/access";
import { SESSION_COOKIE, verifySession } from "../lib/auth/session";
import { requireSecret } from "../lib/secrets/secretStore";

// The authenticated user attached to a request once requireAuth has run. It is
// always loaded fresh from the database, never trusted from the cookie alone,
// so role, org and status reflect the current state of the account.
export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  orgId: string | null;
  // The type of the user's org, resolved fresh alongside the user. Null when the
  // seat has no org. The portfolio surface reads this to decide who is offered a
  // portfolio board; the server still fences the data by binding, never by this.
  orgType: OrgType | null;
  status: User["status"];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

// A small, dependency-free cookie header parser. We only need to read one
// cookie and we control how it is written, so a full cookie library is not
// warranted here.
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Verify the session signature, then reload the user from the database. The
// reload is what makes disabling a user take effect immediately: a disabled
// account is rejected even though its signed cookie is still within its TTL.
export async function loadSessionUser(req: Request): Promise<AuthedUser | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const secret = await requireSecret("SESSION_SECRET");
  const payload = verifySession(token, secret);
  if (!payload) return null;
  const rows = await db
    .select({ user: usersTable, orgType: orgsTable.type })
    .from(usersTable)
    .leftJoin(orgsTable, eq(orgsTable.id, usersTable.orgId))
    .where(eq(usersTable.id, payload.userId))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status === "disabled") return null;
  const user = row.user;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    orgId: user.orgId,
    orgType: row.orgType ?? null,
    status: user.status,
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await loadSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Owner-only gate for the Access console. Must run after requireAuth.
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isOwner(req.user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

// Tenant-scoped gate for per-tenant routes. Must run after requireAuth and on a
// route carrying an :id tenant param. Provider seats pass straight through;
// client and portfolio seats are checked against their org's bindings and get a
// 403 for any tenant they are not bound to.
export async function requireTenantAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const tenantId = String(req.params.id);
    if (isProvider(user.role)) {
      next();
      return;
    }
    if (!user.orgId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const bindings = await db
      .select({ tenantId: orgTenantsTable.tenantId })
      .from(orgTenantsTable)
      .where(eq(orgTenantsTable.orgId, user.orgId));
    const bound = new Set(bindings.map((b) => b.tenantId));
    if (!canAccessTenant(user, tenantId, bound)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
