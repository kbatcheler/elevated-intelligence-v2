import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenantConnectionsTable } from "./tenantConnections";

// A record of one connector extraction run. It holds counts and a provenance
// root hash for the audit trail, never any raw data. The derived output of a run
// lands in derived_signals; the raw extraction is discarded when the run ends.
export const connectorRunStatusEnum = pgEnum("connector_run_status", [
  "running",
  "success",
  "error",
]);

export const connectorRunsTable = pgTable("connector_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantConnectionId: uuid("tenant_connection_id")
    .notNull()
    .references(() => tenantConnectionsTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: connectorRunStatusEnum("status").notNull().default("running"),
  signalsCount: integer("signals_count").notNull().default(0),
  // The root hash of the provenance entries this run produced. No raw data, ever.
  provenanceRootHash: text("provenance_root_hash"),
});

export const insertConnectorRunSchema = createInsertSchema(connectorRunsTable);

export type ConnectorRun = typeof connectorRunsTable.$inferSelect;
export type InsertConnectorRun = typeof connectorRunsTable.$inferInsert;
