import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod/v4";
import { db, ingestionKeysTable, tenantsTable, webhookSourcesTable } from "@workspace/db";
import { isProvider } from "../lib/auth/access";
import { createIngestionKey } from "../lib/ingestion/ingestionCredential";
import { assertIngestibleLayer, IngestionLayerError } from "../lib/ingestion/layers";
import { encryptSecretString } from "../lib/security/secretCrypto";
import { ensureActiveTenantKey } from "../lib/security/tenantKeyService";

// The admin console surface for the ingestion suite (Phase AE): mint, list, and
// revoke per-tenant ingestion keys and per-source webhook receivers. Mounted
// under the shared /api session gate; provider-only, mirroring the agent
// credential routes. Every credential is shown exactly once at mint time and
// only its hash (keys) or ciphertext (webhook secrets) is ever persisted, so
// these routes can issue and revoke but never recover a secret.
export const ingestionAdminRouter = Router();

const WEBHOOK_SECRET_BYTES = 32;

const mintIngestionKeySchema = z.object({ label: z.string().min(1).max(120) });
const mintWebhookSchema = z.object({
  label: z.string().min(1).max(120),
  targetLayer: z.string().min(1).max(120),
});

async function ensureTenant(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return Boolean(rows[0]);
}

// Mint an ingestion key. The full token is returned exactly once; only its scrypt
// hash is stored, so the operator must capture it now.
ingestionAdminRouter.post("/tenants/:id/ingestion-keys", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = mintIngestionKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    if (!(await ensureTenant(tenantId))) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const credential = await createIngestionKey();
    await db.insert(ingestionKeysTable).values({
      id: credential.keyId,
      tenantId,
      label: parsed.data.label,
      tokenHash: credential.tokenHash,
    });
    res
      .status(201)
      .json({ keyId: credential.keyId, label: parsed.data.label, token: credential.token });
  } catch (err) {
    next(err);
  }
});

// List a tenant's ingestion keys. The token hash is never returned; this is the
// issued-and-revoked ledger the console renders.
ingestionAdminRouter.get("/tenants/:id/ingestion-keys", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    const keys = await db
      .select({
        id: ingestionKeysTable.id,
        label: ingestionKeysTable.label,
        status: ingestionKeysTable.status,
        lastUsedAt: ingestionKeysTable.lastUsedAt,
        createdAt: ingestionKeysTable.createdAt,
        revokedAt: ingestionKeysTable.revokedAt,
      })
      .from(ingestionKeysTable)
      .where(eq(ingestionKeysTable.tenantId, tenantId))
      .orderBy(desc(ingestionKeysTable.createdAt));
    res.json({ keys });
  } catch (err) {
    next(err);
  }
});

// Revoke an ingestion key. Takes effect on its next call because the middleware
// reloads the row every time and rejects any status other than active.
ingestionAdminRouter.post("/tenants/:id/ingestion-keys/:keyId/revoke", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    const keyId = String(req.params.keyId);
    const updated = await db
      .update(ingestionKeysTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(ingestionKeysTable.id, keyId), eq(ingestionKeysTable.tenantId, tenantId)))
      .returning({ id: ingestionKeysTable.id });
    if (!updated[0]) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    res.json({ ok: true, keyId, status: "revoked" });
  } catch (err) {
    next(err);
  }
});

// Mint a webhook source. A signing secret is generated, sealed under the tenant
// key, and stored as ciphertext; the plaintext secret and the delivery path are
// returned exactly once. The target layer must be a real, enabled layer.
ingestionAdminRouter.post("/tenants/:id/webhook-sources", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = mintWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    if (!(await ensureTenant(tenantId))) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    try {
      await assertIngestibleLayer(tenantId, parsed.data.targetLayer);
    } catch (err) {
      if (err instanceof IngestionLayerError) {
        res.status(400).json({ error: err.code, layer: parsed.data.targetLayer });
        return;
      }
      throw err;
    }
    const secret = randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url");
    const { kmsKeyRef } = await ensureActiveTenantKey(tenantId);
    const signingSecretCipher = await encryptSecretString(secret, kmsKeyRef);
    const inserted = await db
      .insert(webhookSourcesTable)
      .values({
        tenantId,
        label: parsed.data.label,
        targetLayer: parsed.data.targetLayer,
        signingSecretCipher,
      })
      .returning({ id: webhookSourcesTable.id });
    const sourceId = inserted[0]!.id;
    res.status(201).json({
      sourceId,
      label: parsed.data.label,
      targetLayer: parsed.data.targetLayer,
      deliveryPath: "/api/webhooks/" + sourceId,
      signingSecret: secret,
    });
  } catch (err) {
    next(err);
  }
});

// List a tenant's webhook sources. The sealed secret is never returned.
ingestionAdminRouter.get("/tenants/:id/webhook-sources", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    const sources = await db
      .select({
        id: webhookSourcesTable.id,
        label: webhookSourcesTable.label,
        targetLayer: webhookSourcesTable.targetLayer,
        status: webhookSourcesTable.status,
        lastDeliveryAt: webhookSourcesTable.lastDeliveryAt,
        createdAt: webhookSourcesTable.createdAt,
        revokedAt: webhookSourcesTable.revokedAt,
      })
      .from(webhookSourcesTable)
      .where(eq(webhookSourcesTable.tenantId, tenantId))
      .orderBy(desc(webhookSourcesTable.createdAt));
    res.json({ sources });
  } catch (err) {
    next(err);
  }
});

// Revoke a webhook source. Takes effect on its next delivery because the receiver
// reloads the row every time and rejects any status other than active.
ingestionAdminRouter.post(
  "/tenants/:id/webhook-sources/:sourceId/revoke",
  async (req, res, next) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!isProvider(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      const tenantId = String(req.params.id);
      const sourceId = String(req.params.sourceId);
      const updated = await db
        .update(webhookSourcesTable)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(webhookSourcesTable.id, sourceId),
            eq(webhookSourcesTable.tenantId, tenantId),
          ),
        )
        .returning({ id: webhookSourcesTable.id });
      if (!updated[0]) {
        res.status(404).json({ error: "Source not found" });
        return;
      }
      res.json({ ok: true, sourceId, status: "revoked" });
    } catch (err) {
      next(err);
    }
  },
);
