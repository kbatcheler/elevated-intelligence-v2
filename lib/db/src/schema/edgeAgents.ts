import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenantsTable } from "./tenants";

// A per-tenant credential for the in-client extraction agent (Part 3, Tier 1).
// The agent runs inside the client's own network, registers with this API using
// the credential below, pulls its connector config, runs the tenant's edge
// connectors locally, and posts back only derived signals over mutual TLS.
//
// We store the scrypt hash of the credential secret, never the secret itself, so
// a leak of this table cannot be replayed against the API. The row id is the
// public agent identifier carried in the bearer token; the secret half is shown
// to the operator exactly once, at issue time, and is unrecoverable afterwards.
//
// This table is an addition beyond the Tier 1 minimum schema in the master
// prompt. The in-client agent is itself a Tier 1 feature and needs somewhere to
// anchor its per-tenant credential, and trusting a proxy-injected client
// certificate header instead would let anything past the proxy impersonate any
// tenant's agent. Recorded in the Phase I drift report.
export const edgeAgentStatusEnum = pgEnum("edge_agent_status", ["active", "revoked"]);

export const edgeAgentsTable = pgTable("edge_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  // The scrypt hash of the credential secret, never the secret itself.
  tokenHash: text("token_hash").notNull(),
  status: edgeAgentStatusEnum("status").notNull().default("active"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertEdgeAgentSchema = createInsertSchema(edgeAgentsTable);

export type EdgeAgent = typeof edgeAgentsTable.$inferSelect;
export type InsertEdgeAgent = typeof edgeAgentsTable.$inferInsert;
