import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { tenantsTable } from "./tenants";

// Binding from client and portfolio orgs to the tenants they may see. A client
// org binds one or more tenants; a portfolio org binds many. The provider org
// sees all tenants by role, so it does not need rows here.
export const orgTenantsTable = pgTable(
  "org_tenants",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.tenantId] })],
);

export type OrgTenant = typeof orgTenantsTable.$inferSelect;
export type InsertOrgTenant = typeof orgTenantsTable.$inferInsert;
