import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// Break-glass access grants from the Connectors and SOC 2 spec. The full
// connected-data flow lands later, but the table exists from foundations so
// every later ingestion path has its access contract waiting. A member requests
// time-boxed access to a connected tenant's signals with a reason; the owner
// approves a grant; every grant and every access under it is logged.
export const accessGrantsTable = pgTable("access_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  grantedBy: uuid("granted_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type AccessGrant = typeof accessGrantsTable.$inferSelect;
export type InsertAccessGrant = typeof accessGrantsTable.$inferInsert;
