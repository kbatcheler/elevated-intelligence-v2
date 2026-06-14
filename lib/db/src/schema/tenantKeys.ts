import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenantsTable } from "./tenants";

// Per-tenant cryptographic isolation. Each tenant's stored signals are encrypted
// with a key the client controls in their own key store; our store holds only a
// reference to that key, never the key itself. Revoking the key crypto-shreds the
// tenant's data instantly, turning "prove you deleted everything" into a
// one-step, evidenceable action. The crypto-shred enforcement lands in Phase K;
// the table exists now so the contract is in place.
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
