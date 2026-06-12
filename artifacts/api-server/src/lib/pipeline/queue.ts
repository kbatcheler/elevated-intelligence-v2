// The seed limiter, built on the Postgres-backed pipeline_jobs queue rather than
// in module memory. Concurrency is enforced by the database: a worker claims one
// job at a time with SELECT ... FOR UPDATE SKIP LOCKED, so any number of workers
// across any number of instances share the work without ever double-processing a
// layer, and a crashed worker's job is reclaimed once its lease expires. Each
// instance runs up to LAYER_CONCURRENCY claim loops in parallel.

import { eq, sql } from "drizzle-orm";
import { db, pipelineJobsTable, type SeedLayerPayload } from "@workspace/db";

// A claimed job's lease. A layer run drives nine sub-stages across three model
// providers and can take minutes, so the lease is generous: it only expires if
// the worker truly died, at which point another worker reclaims the job and
// runLayer resumes it from its last committed sub-stage.
const DEFAULT_LEASE_MS = 15 * 60 * 1000;

// The number of layers a single instance processes concurrently. Env-tunable so
// it can be raised (watching for model 429 backoffs becoming the binding
// constraint) without a redeploy. Default 5.
export function layerConcurrency(): number {
  const raw = process.env["LAYER_CONCURRENCY"];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

// Replace any existing jobs for this tenant with a fresh queued set, one per
// layer. A new seed run owns the tenant's queue; resumability lives in runLayer
// (it skips an already-built layer cheaply), so re-enqueuing every layer is safe
// and idempotent at the tenant grain.
export async function enqueueSeedLayers(
  tenantId: string,
  layerKeys: string[],
  mode: "full" | "express",
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(pipelineJobsTable).where(eq(pipelineJobsTable.tenantId, tenantId));
    if (layerKeys.length === 0) return;
    await tx.insert(pipelineJobsTable).values(
      layerKeys.map((layerKey) => ({
        type: "seed-layer",
        tenantId,
        payload: { tenantId, layerKey, mode } satisfies SeedLayerPayload,
      })),
    );
  });
}

export interface ClaimedJob {
  id: string;
  payload: SeedLayerPayload;
}

// Atomically claim the next runnable job for this tenant: a queued job, or a
// claimed job whose lease has expired (its worker is presumed dead). The
// FOR UPDATE SKIP LOCKED subquery makes this safe across many concurrent
// workers and instances: each row is handed to exactly one claimer.
export async function claimNextSeedJob(
  tenantId: string,
  workerId: string,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<ClaimedJob | null> {
  const result = await db.execute<{ id: string; payload: SeedLayerPayload }>(sql`
    UPDATE ${pipelineJobsTable}
    SET status = 'claimed',
        claimed_by = ${workerId},
        lease_expires_at = now() + (${`${leaseMs} milliseconds`})::interval,
        attempts = ${pipelineJobsTable.attempts} + 1,
        updated_at = now()
    WHERE id = (
      SELECT id FROM ${pipelineJobsTable}
      WHERE tenant_id = ${tenantId}
        AND type = 'seed-layer'
        AND (status = 'queued' OR (status = 'claimed' AND lease_expires_at < now()))
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, payload
  `);
  const row = result.rows[0];
  return row ? { id: row.id, payload: row.payload } : null;
}

// Mark a claimed job terminal. The claim is released (claimed_by/lease cleared)
// so the row is inert; the run pointer and any error are recorded for the queue
// to be inspectable.
export async function markSeedJob(
  jobId: string,
  status: "done" | "error",
  opts: { runId?: string; lastError?: string } = {},
): Promise<void> {
  await db
    .update(pipelineJobsTable)
    .set({
      status,
      claimedBy: null,
      leaseExpiresAt: null,
      runId: opts.runId ?? null,
      lastError: opts.lastError ?? null,
    })
    .where(eq(pipelineJobsTable.id, jobId));
}
