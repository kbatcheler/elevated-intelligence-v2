import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// Dead-link reporting. Every time a reader clicks "report broken link" inside a
// verified-claim tooltip we append one row here. Intentionally append-only and
// lightweight: no de-duplication at the schema layer (rate-limit lives in the
// route). Tenant cascade-deletes so removing a tenant cleans up its reports.
export const claimBrokenReportsTable = pgTable("claim_broken_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  layerKey: text("layer_key").notNull(),
  claimPath: text("claim_path").notNull(),
  sourceUrl: text("source_url").notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  reportedBy: text("reported_by").notNull().default("anonymous"),
});

export const insertClaimBrokenReportSchema = createInsertSchema(claimBrokenReportsTable, {
  layerKey: z.string().min(1).max(80),
  claimPath: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(2000),
  reportedBy: z.string().max(120).optional(),
}).omit({ id: true, reportedAt: true });

export type ClaimBrokenReport = typeof claimBrokenReportsTable.$inferSelect;
export type InsertClaimBrokenReport = typeof claimBrokenReportsTable.$inferInsert;
