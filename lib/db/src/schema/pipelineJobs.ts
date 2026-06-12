import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { tenantPipelineRunsTable } from "./tenantPipelineRuns";

// A generic, Postgres-backed work queue. The seed limiter is built on this from
// the start: the Core Master Prompt brings the Platform-phase queue forward so
// concurrency is not held in module memory but in the database, where it is
// correct across many instances. A worker claims a job with
// SELECT ... FOR UPDATE SKIP LOCKED, so no two workers ever take the same row,
// and a crashed worker's job is reclaimed once its lease expires. Phase AH
// (portability) and the connector phases extend this same table with new job
// types rather than inventing their own queue.
export const pipelineJobStatusEnum = pgEnum("pipeline_job_status", [
  "queued",
  "claimed",
  "done",
  "error",
]);

// The seed-layer payload: which tenant layer to build and in which mode. Stored
// as typed jsonb so the table stays generic for future job types.
export type SeedLayerPayload = {
  tenantId: string;
  layerKey: string;
  mode: "full" | "express";
};

export const pipelineJobsTable = pgTable("pipeline_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The job type. Only "seed-layer" exists today; the column lets later phases
  // add job types without a new table.
  type: text("type").notNull(),
  // The tenant this job belongs to, when applicable. A FK so a deleted tenant's
  // queued jobs are cleared with it.
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull().$type<SeedLayerPayload | Record<string, unknown>>(),
  status: pipelineJobStatusEnum("status").notNull().default("queued"),
  // How many times this job has been claimed. Rises on every claim, including a
  // reclaim after a lease expiry, so a permanently failing job is visible.
  attempts: integer("attempts").notNull().default(0),
  // The worker instance that holds the current claim, and when that claim
  // expires. A claim past its lease is reclaimable: the worker is presumed
  // crashed.
  claimedBy: text("claimed_by"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  // The pipeline run this job produced, set when the job reaches a terminal
  // state. A direct pointer from the queue to the per-layer run row.
  runId: uuid("run_id").references(() => tenantPipelineRunsTable.id, { onDelete: "set null" }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PipelineJob = typeof pipelineJobsTable.$inferSelect;
export type InsertPipelineJob = typeof pipelineJobsTable.$inferInsert;
