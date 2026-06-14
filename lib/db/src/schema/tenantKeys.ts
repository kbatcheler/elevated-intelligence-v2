import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenantsTable } from "./tenants";

// Per-tenant cryptographic isolation. Each tenant's stored signals are encrypted
// under a per-tenant key encryption key (KEK). This table holds only a reference
// to that KEK (kmsKeyRef), never the key material. With a customer-managed KMS
// (the production target) the material lives in the client's own key service;
// with the local software KMS stand-in used in this deployment the material lives
// in a same-database table (kms_local_keys), co-located with the ciphertext it
// protects. Revoking the key crypto-shreds the tenant's data, turning "prove you
// deleted everything" into a one-step, evidenceable action. The crypto-shred
// enforcement lands in Phase K.
export const tenantKeyStatusEnum = pgEnum("tenant_key_status", ["active", "revoked"]);

export const tenantKeysTable = pgTable("tenant_keys", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  // A reference to the client-managed key, never the key material.
  kmsKeyRef: text("kms_key_ref").notNull(),
  status: tenantKeyStatusEnum("status").notNull().default("active"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertTenantKeySchema = createInsertSchema(tenantKeysTable);

export type TenantKey = typeof tenantKeysTable.$inferSelect;
export type InsertTenantKey = typeof tenantKeysTable.$inferInsert;
