import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenantsTable } from "./tenants";

// An append-only, tamper-evident record of which source produced each claim.
// Each entry chains to the previous one by hash, so tampering is detectable. It
// stores references and content hashes, never raw data. The same ledger is the
// product's provenance feature and the Processing Integrity evidence for the
// audit.
//
// Append-only is enforced at the application layer: rows are inserted, never
// updated or deleted. The intent is to also enforce it at the database layer in
// Phase K (restricted grants or a block trigger on update and delete). The
// ledger writing itself (during narrate and score) lands in Phase K; the table
// exists now so the contract is in place.
export const provenanceLedgerTable = pgTable("provenance_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  claimPath: text("claim_path"),
  sourceRef: text("source_ref"),
  contentHash: text("content_hash").notNull(),
  prevHash: text("prev_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProvenanceLedgerSchema = createInsertSchema(provenanceLedgerTable);

export type ProvenanceLedgerEntry = typeof provenanceLedgerTable.$inferSelect;
export type InsertProvenanceLedgerEntry = typeof provenanceLedgerTable.$inferInsert;
