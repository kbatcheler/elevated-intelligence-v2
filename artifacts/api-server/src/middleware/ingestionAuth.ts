import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, ingestionKeysTable } from "@workspace/db";
import {
  parseIngestionToken,
  spendDummyVerify,
  verifyIngestionSecret,
} from "../lib/ingestion/ingestionCredential";

// The ingestion identity attached to a request once requireIngestionKey has run.
// It is always loaded fresh from ingestion_keys, so revoking a key takes effect
// on its very next call.
export interface AuthedIngestionKey {
  id: string;
  tenantId: string;
  label: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ingestionKey?: AuthedIngestionKey;
    }
  }
}

// Gate the ingestion surface on the per-tenant ingestion key, and only that. The
// credential is a bearer token; it is the sole proof of identity and the tenant
// is resolved from the key, never from the request body. Mirrors requireAgent:
// the row is loaded fresh, a revoked or unknown key is a flat 401, and the miss
// path spends the same scrypt time so timing does not leak whether a key exists.
export async function requireIngestionKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = parseIngestionToken(req.headers.authorization);
    if (!parsed) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const rows = await db
      .select()
      .from(ingestionKeysTable)
      .where(eq(ingestionKeysTable.id, parsed.keyId))
      .limit(1);
    const key = rows[0];
    if (!key || key.status !== "active") {
      await spendDummyVerify(parsed.secret);
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const ok = await verifyIngestionSecret(parsed.secret, key.tokenHash);
    if (!ok) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    await db
      .update(ingestionKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(ingestionKeysTable.id, key.id));
    req.ingestionKey = { id: key.id, tenantId: key.tenantId, label: key.label };
    next();
  } catch (err) {
    next(err);
  }
}
