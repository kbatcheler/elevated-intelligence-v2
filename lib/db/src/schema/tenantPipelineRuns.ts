import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// The nine cortex sub-stages per layer. The confound stage is a genuine stage
// in its own right, inserted before challenge: it is not a flag on another
// stage. This ordering is fixed by the Day One Non-Negotiable.
export const PIPELINE_SUB_STAGES = [
  "perceive",
  "hypothesise",
  "confound",
  "challenge",
  "narrate",
  "score",
  "hero",
  "peers",
  "supplements",
] as const;

export type PipelineSubStageName = (typeof PIPELINE_SUB_STAGES)[number];

// Per-seat telemetry captured for each sub-stage: which model seat ran it, and
// its token, latency and search-call cost. Populated by the cortex; the shape
// exists from foundations so the Intelligence Architecture page has its
// contract waiting.
export type SeatTelemetry = {
  seat?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  // Prompt-cache accounting (Anthropic seats): input tokens served from a
  // cached prefix, and tokens written to the cache. The observable proof that
  // the per-tenant profile and schema are reused across layers.
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  latencyMs?: number;
  searchCalls?: number;
  // True for a sub-stage whose model cost was folded into a sibling's single
  // batched call (hero+peers+supplements run as one Haiku call). The
  // Intelligence Architecture summation skips these so cost is not tripled.
  batched?: boolean;
};

export type PipelineSubStage = {
  name: PipelineSubStageName;
  // "skipped" is an honest terminal state for a sub-stage the reduced express
  // chain deliberately did not run (confound and challenge on a non-priority
  // layer). It is distinct from "done": no model call was made and no output
  // exists. The status lives on jsonb, so adding it needs no migration.
  status: "pending" | "running" | "done" | "error" | "skipped";
  durationMs?: number;
  error?: string;
  telemetry?: SeatTelemetry;
  // The validated stage output, persisted so a run is fully inspectable and the
  // next stage can read its predecessor across a resume. Untyped at the db edge
  // (each stage validates its own shape via the cortex schemas).
  output?: unknown;
};

export const pipelineRunStatusEnum = pgEnum("pipeline_run_status", [
  "queued",
  "running",
  "done",
  "error",
]);

export const tenantPipelineRunsTable = pgTable("tenant_pipeline_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  // Which layer this run produced, or null for a cross-layer artifact run.
  layerKey: text("layer_key"),
  status: pipelineRunStatusEnum("status").notNull().default("queued"),
  // The per-sub-stage state, resumable across restarts.
  subStages: jsonb("sub_stages").notNull().$type<PipelineSubStage[]>().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
});

export type TenantPipelineRun = typeof tenantPipelineRunsTable.$inferSelect;
export type InsertTenantPipelineRun = typeof tenantPipelineRunsTable.$inferInsert;
