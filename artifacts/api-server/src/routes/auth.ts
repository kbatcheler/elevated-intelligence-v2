import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { Router, type Response } from "express";
import { z } from "zod";
import {
  db,
  invitePinsTable,
  orgsTable,
  usersTable,
  type User,
  type UserRole,
} from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import { canonicalizePinCode, hashPinCode } from "../lib/auth/pin";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "../lib/auth/session";
import { logger } from "../lib/logger";
import { requireSecret } from "../lib/secrets/secretStore";
import { loadSessionUser } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rateLimit";

export const authRouter: Router = Router();

const WINDOW_MS = 15 * 60 * 1000;

// Both entry points are rate limited to blunt brute force. Login is keyed by IP
// and email so guessing one account does not lock out another from the same
// network. Limits are generous because the platform target is a single VM with
// an in-memory limiter; the exact numbers are a defaulted decision logged in
// the drift report.
const registerLimiter = createRateLimiter({
  windowMs: WINDOW_MS,
  max: 50,
  keyFn: (req) => "register:" + req.ip,
});
const loginLimiter = createRateLimiter({
  windowMs: WINDOW_MS,
  max: 50,
  keyFn: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
    return "login:" + req.ip + ":" + email;
  },
});

const registerSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
  pin: z.string().min(1).max(64),
});

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

class PinUnavailableError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

function userSummary(user: Pick<User, "id" | "email" | "displayName" | "role" | "orgId">) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    orgId: user.orgId,
  };
}

async function setSessionCookie(res: Response, userId: string, role: UserRole): Promise<void> {
  const secret = await requireSecret("SESSION_SECRET");
  const token = signSession({ userId, role, iat: Math.floor(Date.now() / 1000) }, secret);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

// PIN-gated self-registration. Every one of the four PIN failure modes (wrong,
// expired, revoked, used-up) collapses to one generic response so a caller
// cannot tell a valid-but-spent PIN from a bad guess. The PIN is consumed with
// a single conditional UPDATE inside the same transaction as the user INSERT,
// so concurrent registrations cannot over-consume a single-use PIN, and an
// email collision rolls the whole thing back, un-consuming the PIN.
authRouter.post("/register", registerLimiter, async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const canonical = canonicalizePinCode(parsed.data.pin);
  if (!canonical) {
    res.status(403).json({ error: "invalid_or_used_pin" });
    return;
  }

  try {
    const secret = await requireSecret("SESSION_SECRET");
    const codeHash = hashPinCode(canonical, secret);
    const passwordHash = await hashPassword(parsed.data.password);

    const created = await db.transaction(async (tx) => {
      const consumed = await tx
        .update(invitePinsTable)
        .set({ useCount: sql`${invitePinsTable.useCount} + 1` })
        .where(
          and(
            eq(invitePinsTable.codeHash, codeHash),
            isNull(invitePinsTable.revokedAt),
            gt(invitePinsTable.expiresAt, new Date()),
            lt(invitePinsTable.useCount, invitePinsTable.maxUses),
          ),
        )
        .returning({
          id: invitePinsTable.id,
          scopeOrgId: invitePinsTable.scopeOrgId,
          scopeRole: invitePinsTable.scopeRole,
        });

      const pin = consumed[0];
      if (!pin) throw new PinUnavailableError();

      const role: UserRole = pin.scopeRole ?? "provider-member";
      let orgId = pin.scopeOrgId;
      if (orgId === null && (role === "provider-member" || role === "provider-owner")) {
        const provider = (
          await tx.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.type, "provider")).limit(1)
        )[0];
        orgId = provider?.id ?? null;
      }

      const inserted = await tx
        .insert(usersTable)
        .values({
          email,
          displayName: parsed.data.displayName,
          passwordHash,
          role,
          status: "active",
          orgId,
          invitePinId: pin.id,
        })
        .returning();
      return inserted[0];
    });

    await setSessionCookie(res, created.id, created.role);
    logger.info({ userId: created.id, role: created.role }, "user registered");
    res.status(201).json({ user: userSummary(created) });
  } catch (err) {
    if (err instanceof PinUnavailableError) {
      res.status(403).json({ error: "invalid_or_used_pin" });
      return;
    }
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "email_taken" });
      return;
    }
    next(err);
  }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  try {
    const rows = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    const user = rows[0];
    // Generic message for an unknown email or a wrong password so the endpoint
    // does not reveal which accounts exist.
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    if (user.status === "disabled") {
      res.status(403).json({ error: "account_disabled" });
      return;
    }
    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await setSessionCookie(res, user.id, user.role);
    res.json({ user: userSummary(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/status", async (req, res, next) => {
  try {
    const user = await loadSessionUser(req);
    if (!user) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        orgId: user.orgId,
      },
    });
  } catch (err) {
    next(err);
  }
});
