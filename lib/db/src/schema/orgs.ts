import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Different Day is the single provider org. Each client engagement is a client
// org bound to one or more tenants. A portfolio org binds many tenants for a
// multi-tenant ranked view. The org model is native, not a later bolt-on.
export const orgTypeEnum = pgEnum("org_type", ["provider", "client", "portfolio"]);

export const orgsTable = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: orgTypeEnum("type").notNull().default("client"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Org = typeof orgsTable.$inferSelect;
export type InsertOrg = typeof orgsTable.$inferInsert;
export type OrgType = Org["type"];
