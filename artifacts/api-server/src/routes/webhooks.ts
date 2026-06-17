import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod/v4";
import { db, webhookSourcesTable } from "@workspace/db";
import { ingestDerivedSignalSet } from "../lib/ingestion/ingestCore";
import { decryptSecretString } from "../lib/security/secretCrypto";
import { ensureActiveTenantKey } from "../lib/security/tenantKeyService";
import { createRateLimiter } from "../middleware/rateLimit";

// The inbound webhook receiver (Phase AE, ingestion path 2). Public, no session:
// the only proof of authenticity is an HMAC over the raw request body, computed
// with the per-source signing secret. The secret is never an env or a shared key;
// it is the one sealed under the tenant key at mint time, opened here only to
// recompute the HMAC, and a timing-safe compare decides the request. The payload
// is derived numeric math by contract; the target layer comes from the source row,
// not the body, and no raw artifact is stored.
export const webhookRouter = Router();

const SIG_RE = /^sha256=([0-9a-f]{64})$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keyed by source id so one noisy source cannot starve another. Falls back to ip.
const webhookLimiter = createRateLimiter({
  name: "webhooks",
  windowMs: 60_000,
  max: 240,
  keyFn: (req) => String(req.params.sourceId ?? req.ip ?? "unknown"),
});

const webhookBodySchema = z.object({
  signals: z.array(z.unknown()).max(5000),
  generatedAt: z.string().min(1).max(40).optional(),
  windowStart: z.string().min(1).max(40).optional(),
  windowEnd: z.string().min(1).max(40).optional(),
});

// Constant-time hex comparison. Guards length first (timingSafeEqual throws on a
// length mismatch), then compares the decoded bytes.
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

webhookRouter.post("/:sourceId", webhookLimiter, async (req, res, next) => {
  try {
    const sourceId = String(req.params.sourceId);
    if (!UUID_RE.test(sourceId)) {
      res.status(404).json({ error: "unknown_source" });
      return;
    }
    const rows = await db
      .select()
      .from(webhookSourcesTable)
      .where(eq(webhookSourcesTable.id, sourceId))
      .limit(1);
    const source = rows[0];
    // A revoked or unknown source is indistinguishable to the caller: both 404,
    // so revocation takes effect on the next delivery and leaks nothing.
    if (!source || source.status !== "active") {
      res.status(404).json({ error: "unknown_source" });
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({ error: "missing_body" });
      return;
    }

    const header = (req.header("x-ei-signature") ?? "").trim();
    const sig = SIG_RE.exec(header);
    if (!sig) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }
    const provided = sig[1]!.toLowerCase();

    // Resolve the secret: the tenant's active key opens the sealed signing secret.
    // A crypto-shredded or unreadable secret cannot verify anything, so fail
    // closed with the same 401 a bad signature gets.
    const { kmsKeyRef } = await ensureActiveTenantKey(source.tenantId);
    let secret: string;
    try {
      secret = await decryptSecretString(source.signingSecretCipher, kmsKeyRef);
    } catch {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!timingSafeHexEqual(expected, provided)) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    const parsed = webhookBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_request", detail: parsed.error.issues[0]?.message });
      return;
    }

    let result;
    try {
      result = await ingestDerivedSignalSet({
        tenantId: source.tenantId,
        method: "webhook",
        feedKey: sourceId,
        layers: [source.targetLayer],
        signals: parsed.data.signals,
        generatedAt: parsed.data.generatedAt,
        windowStart: parsed.data.windowStart,
        windowEnd: parsed.data.windowEnd,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid signal set";
      if (/derive|signal|numeric|raw|strict|expected/i.test(message)) {
        res.status(400).json({ error: "invalid_signals", detail: message });
        return;
      }
      throw err;
    }

    await db
      .update(webhookSourcesTable)
      .set({ lastDeliveryAt: new Date() })
      .where(eq(webhookSourcesTable.id, sourceId));

    res.status(202).json({
      accepted: true,
      rootHash: result.rootHash,
      signalsCount: result.signalsCount,
    });
  } catch (err) {
    next(err);
  }
});
