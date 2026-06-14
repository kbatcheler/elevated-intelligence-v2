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
  // Phase O operational reality. lastSuccessAt drives the health derivation
  // (healthy, degraded, error) together with the descriptor staleness threshold.
  // tokenExpiresAt drives the OAuth refresh scheduler. cursorWatermark holds the
  // incremental cursor, only the watermark and never the source data behind it.
  // The lastError trio records the most recent failure for the Connections
  // screen, including "re-authentication required" after a failed token refresh.
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  cursorWatermark: jsonb("cursor_watermark"),
  lastErrorCode: text("last_error_code"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantConnectionSchema = createInsertSchema(tenantConnectionsTable);

export type TenantConnection = typeof tenantConnectionsTable.$inferSelect;
export type InsertTenantConnection = typeof tenantConnectionsTable.$inferInsert;
