import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { EncryptedSignalEnvelope } from "../contracts/signalEnvelope";
import { tenantsTable } from "./tenants";

// A per-source inbound webhook receiver (Phase AE). Each source has its own
// signing secret, used to verify an HMAC over the raw request body. HMAC
// verification needs the secret back, so it cannot be one-way hashed like a
// credential; it is sealed at rest under the tenant key instead, in the same
// envelope shape the derived signal values use. A leak of this table therefore
// yields only ciphertext, and revoking the tenant key crypto-shreds the secret
// along with the tenant's derived signals. The secret is shown to the operator
// exactly once, at issue time.
export const webhookSourceStatusEnum = pgEnum("webhook_source_status", ["active", "revoked"]);

export const webhookSourcesTable = pgTable("webhook_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  // The layer this source's events feed. Plain text key; the registry owns identity.
  targetLayer: text("target_layer").notNull(),
  // The signing secret sealed under the tenant key. Ciphertext only, never plaintext.
  signingSecretCipher: jsonb("signing_secret_cipher").notNull().$type<EncryptedSignalEnvelope>(),
  status: webhookSourceStatusEnum("status").notNull().default("active"),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertWebhookSourceSchema = createInsertSchema(webhookSourcesTable);

export type WebhookSource = typeof webhookSourcesTable.$inferSelect;
export type InsertWebhookSource = typeof webhookSourcesTable.$inferInsert;
