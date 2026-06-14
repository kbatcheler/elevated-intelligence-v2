import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The LOCAL key management emulation. This table is NOT the customer key store
// and NOT the reference table (tenant_keys holds only the reference). It exists
// solely so the local KMS stand-in has a durable place to hold per-tenant key
// material in development and CI, emulating an external KMS we do not have wired
// in this deployment. It is kept off the application SecretStore on purpose: app
// secrets (third-party API keys) and key material are different concerns, and
// the SecretStore is swapped or mocked for app-secret control in places that
// must never disturb tenant crypto. In production a customer-managed KMS holds
// the key (see CustomerKmsRuntime) and this table is unused. Destroying a row
// here is the crypto-shred: the wrapped data keys that pointed at it can never be
// unwrapped again.
export const kmsLocalKeysTable = pgTable("kms_local_keys", {
  keyRef: text("key_ref").primaryKey(),
  // Base64 of the 32-byte key encryption key. Never logged.
  material: text("material").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KmsLocalKey = typeof kmsLocalKeysTable.$inferSelect;
export type InsertKmsLocalKey = typeof kmsLocalKeysTable.$inferInsert;
