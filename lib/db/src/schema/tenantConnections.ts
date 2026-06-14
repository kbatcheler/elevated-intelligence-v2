import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { connectorDeploymentEnum, connectorsTable } from "./connectors";
import { tenantsTable } from "./tenants";

// A tenant's connection to a catalogue connector. This holds connection state
// and a pointer into the secret vault (authRef), never the secret itself and
// never any raw client data. A connector with no row here is, for that tenant,
// available but not connected.
export const tenantConnectionStatusEnum = pgEnum("tenant_connection_status", [
  "disconnected",
  "connected",
  "error",
]);

export const tenantConnectionsTable = pgTable("tenant_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  connectorKey: text("connector_key")
    .notNull()
    .references(() => connectorsTable.key, { onDelete: "restrict" }),
  status: tenantConnectionStatusEnum("status").notNull().default("disconnected"),
  // A reference into the secret vault, never the credential itself.
  authRef: text("auth_ref"),
  // Non-identifying connection configuration: which measures or windows to
  // extract. No raw records.
  scopeConfig: jsonb("scope_config"),
  deploymentMode: connectorDeploymentEnum("deployment_mode"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantConnectionSchema = createInsertSchema(tenantConnectionsTable);

export type TenantConnection = typeof tenantConnectionsTable.$inferSelect;
export type InsertTenantConnection = typeof tenantConnectionsTable.$inferInsert;
