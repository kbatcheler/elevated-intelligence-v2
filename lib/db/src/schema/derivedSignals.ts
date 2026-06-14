import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenantsTable } from "./tenants";

// The "math, not records" store. Each row is one derived signal computed by a
// connector: a number or a numeric vector, never a raw record, name, account
// number, email, or free-text. The value column is constrained at the
// application boundary by the DerivedSignalSet contract (derivedSignalSet.ts),
// which rejects anything outside the allowed numeric shape. In Tier 3 these rows
// are encrypted per tenant with a client-managed key.
export const derivedSignalsTable = pgTable("derived_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  // The layer this signal feeds. Plain text key; the registry owns identity.
  layerKey: text("layer_key").notNull(),
  signalKey: text("signal_key").notNull(),
  // A finite number or a numeric array only. Enforced by the DerivedSignalSet
  // guard before any write reaches this table.
  value: jsonb("value").notNull().$type<number | number[]>(),
  window: text("window"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  sourceConnectorKey: text("source_connector_key"),
  provenanceRef: text("provenance_ref"),
});

export const insertDerivedSignalSchema = createInsertSchema(derivedSignalsTable);

export type DerivedSignalRow = typeof derivedSignalsTable.$inferSelect;
export type InsertDerivedSignalRow = typeof derivedSignalsTable.$inferInsert;
