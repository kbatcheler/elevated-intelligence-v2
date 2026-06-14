import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accessGrantsTable } from "./accessGrants";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// Every human read of a connected tenant's raw signal values appends one row
// here, under the break-glass grant that authorised it. access_grants records
// the grant; this records each access under it, so "who read what, when, under
// which grant" is answerable for the audit. There is no standing access: a read
// without an active grant never reaches this table because it is denied first.
// Append-only at the application layer (insert only, never updated or deleted).
export const accessGrantEventsTable = pgTable("access_grant_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantId: uuid("grant_id")
    .notNull()
    .references(() => accessGrantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccessGrantEvent = typeof accessGrantEventsTable.$inferSelect;
export type InsertAccessGrantEvent = typeof accessGrantEventsTable.$inferInsert;
