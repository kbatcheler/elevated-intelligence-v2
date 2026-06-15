import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantStatusEnum = pgEnum("tenant_status", [
  "seeding",
  "ready",
  "failed",
  "stale",
]);

// How a tenant's intelligence is sourced. outside_in is the default: derived from
// public and outside-in signals only, with no client systems connected.
// connected means the tenant has live connectors feeding derived signals. This
// column declares the mode; the pipeline behavior that branches on it is wired in
// a later phase, so the value is recorded but not yet acted upon.
export const tenantDataModeEnum = pgEnum("tenant_data_mode", ["outside_in", "connected"]);

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
  dataMode: tenantDataModeEnum("data_mode").notNull().default("outside_in"),
  // Phase X consent: whether this tenant has explicitly opted in to contribute to
  // and receive cohort benchmarks. Default off; flipped only through the consent
  // route, which logs every change to benchmark_consent_events. Opting out removes
  // the tenant from the next benchmark recompute (the recompute source query
  // selects only opted-in tenants), so contribution stops without touching history.
  benchmarkOptIn: boolean("benchmark_opt_in").notNull().default(false),
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
  benchmarkOptIn: true,
});

export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
export type TenantStatus = Tenant["status"];
