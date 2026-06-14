import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// One row per REAL model call made by the pipeline (Phase N, Cost and Token
// Observability). Every column is measured, never modelled: the token counts
// come straight from the provider wrappers' telemetry, and costUsd is those
// counts multiplied by the configured list-price rates (lib/cortex/pricing).
// There is no fabricated spend here. A self-hosted or unknown model prices at
// zero because it incurs no external per-token charge, which is honest, not a
// silent fallback.
//
// The row is deliberately decoupled from the run and tenant lifecycles: it is an
// operational and financial ledger (token counts and cost, never client
// content), so it must survive a tenant deletion rather than cascade away and
// silently drop the global spend history. tenantId therefore nulls out on a
// tenant delete instead of cascading, and runId is a plain reference with no
// foreign key (the profile call has no layer run at all).
export const modelUsageTable = pgTable(
  "model_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The tenant this call was made for. Null only after the tenant is deleted
    // (the cost row is kept so global totals stay honest) or for a call that has
    // no tenant scope. Populated for every normal call, including the profile.
    tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
    // The per-layer pipeline run this call belongs to, or null for the
    // tenant-scope profile call, which has no layer run. No foreign key: the
    // ledger outlives the run rows it references.
    runId: uuid("run_id"),
    // The sub-stage label (perceive, hypothesise, ..., score), "enrichment" for
    // the single batched Evaluator call, or "profile" for the profile call.
    stage: text("stage").notNull(),
    // The registry layer this call produced, or null for the profile call (which
    // is tenant-scope, not per-layer).
    layerKey: text("layer_key"),
    // The product role that ran the call (Lens, Synthesist, Confounder, ...). The
    // by-seat spend breakdown groups on this.
    seat: text("seat").notNull(),
    // The resolved model identifier, as reported by the wrapper telemetry.
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Prompt-cache accounting (Anthropic seats): tokens read from a cached prefix
    // and tokens written to the cache. Priced at the cache rates, not the input
    // rate, so the cost reflects the real saving.
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    // Server-side web-search tool invocations (perceive). Billed per call.
    webSearchCalls: integer("web_search_calls").notNull().default(0),
    // The computed dollar cost of this single call: token counts x configured
    // list-price rates, rounded to six decimal places. Numeric, never float, so
    // the summed ledger never drifts.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("model_usage_tenant_idx").on(t.tenantId),
    createdIdx: index("model_usage_created_idx").on(t.createdAt),
  }),
);

export type ModelUsageRow = typeof modelUsageTable.$inferSelect;
export type InsertModelUsage = typeof modelUsageTable.$inferInsert;
