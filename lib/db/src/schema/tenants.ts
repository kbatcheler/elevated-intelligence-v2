import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantStatusEnum = pgEnum("tenant_status", [
  "seeding",
  "ready",
  "failed",
  "stale",
]);

export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sector: text("sector"),
  hqCity: text("hq_city"),
  hqState: text("hq_state"),
  revenueBand: text("revenue_band"),
  ownership: text("ownership"),
  founded: integer("founded"),
  tagline: text("tagline"),
  status: tenantStatusEnum("status").notNull().default("seeding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: text("created_by").notNull().default("owner"),
  lastSeededAt: timestamp("last_seeded_at", { withTimezone: true }),
  staleAfter: timestamp("stale_after", { withTimezone: true }),
});

export const insertTenantSchema = createInsertSchema(tenantsTable, {
  name: z.string().min(1).max(200),
  url: z.string().url().max(2000),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  lastSeededAt: true,
  staleAfter: true,
});

export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
export type TenantStatus = Tenant["status"];
