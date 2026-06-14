import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// The connector catalogue, mostly static, seeded from the connector registry in
// lib/connectors. This table is the declared surface: every connector the system
// knows about, mapped to the 14 layers it feeds, whether or not its runtime is
// implemented yet. Whether a given tenant has connected one lives in
// tenant_connections, never here. status is available or beta only.
//
// Part of the Connectors and SOC 2 architecture. The governing principle is
// derive and discard: a connector returns only a DerivedSignalSet (math), never
// raw client records, so nothing reversible is ever stored.
export const connectorStatusEnum = pgEnum("connector_status", ["available", "beta"]);

// The connector families from the spec. Stable set, so an enum keeps the
// catalogue honest and the portal grouping consistent.
export const connectorFamilyEnum = pgEnum("connector_family", [
  "accounting-erp",
  "crm-sales",
  "marketing-web-analytics",
  "commerce-pos-inventory",
  "supply-chain-logistics",
  "hris-ats",
  "contracts-documents",
  "support-customer",
  "reputation-social",
  "warehouse-bi",
]);

// How a connector authorizes. warehouseCredential is the bring-your-own-warehouse
// path, file is a delivered extract (SFTP or upload), the rest are token flows.
export const connectorAuthMethodEnum = pgEnum("connector_auth_method", [
  "oauth2",
  "apiKey",
  "warehouseCredential",
  "file",
]);

// Where extraction runs. edge means the in-client agent inside the client's own
// network; boundary means a runtime self-hosted inside our deployment boundary.
// Raw client records never transit a third-party aggregator's cloud in either.
export const connectorDeploymentEnum = pgEnum("connector_deployment", ["edge", "boundary"]);

export const connectorsTable = pgTable("connectors", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  family: connectorFamilyEnum("family").notNull(),
  // The layer keys this connector feeds. Plain text array; the layer registry
  // remains the single source of truth for layer identity.
  layers: text("layers").array().notNull(),
  authMethod: connectorAuthMethodEnum("auth_method").notNull(),
  deployment: connectorDeploymentEnum("deployment").notNull(),
  // The derived-signal keys this connector can emit, declared up front.
  signalsProduced: text("signals_produced").array().notNull(),
  status: connectorStatusEnum("status").notNull().default("available"),
});

export const insertConnectorSchema = createInsertSchema(connectorsTable);

export type ConnectorRow = typeof connectorsTable.$inferSelect;
export type InsertConnectorRow = typeof connectorsTable.$inferInsert;
