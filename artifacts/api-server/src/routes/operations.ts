import { desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import {
  alertEventsTable,
  db,
  pipelineJobsTable,
  tenantPipelineRunsTable,
  tenantsTable,
  type PipelineSubStage,
} from "@workspace/db";

export const operationsRouter: Router = Router();

// The owner Operations screen data. Mounted behind requireAuth + requireOwner in
// app.ts, so this handler does not re-check the role. Every figure is read from
// real tables (the pipeline_jobs claim queue, the tenant_pipeline_runs ledger,
// and the alert_events seam); nothing here is estimated or fabricated. An empty
// system honestly returns empty lists and zero counts rather than a placeholder.

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// The first sub-stage in a given state, used to surface which stage a run is on
// (running) or which stage broke it (error). Reads the resumable sub_stages
// jsonb; returns null when none match or the column is unexpectedly shaped.
function stageWithStatus(subStages: unknown, status: PipelineSubStage["status"]): string | null {
  if (!Array.isArray(subStages)) return null;
  for (const s of subStages as PipelineSubStage[]) {
    if (s && s.status === status) return s.name;
  }
  return null;
}

operationsRouter.get("/summary", async (_req, res, next) => {
  try {
    // Seed queue depth straight from the claim queue, grouped by status. queued
    // is waiting work, claimed is in-flight (a worker holds a lease).
    const jobRows = await db
      .select({ status: pipelineJobsTable.status, count: sql<string>`count(*)` })
      .from(pipelineJobsTable)
      .groupBy(pipelineJobsTable.status);
    const queueDepth = { queued: 0, claimed: 0, done: 0, error: 0 };
    for (const r of jobRows) {
      if (r.status in queueDepth) queueDepth[r.status as keyof typeof queueDepth] = num(r.count);
    }

    // In-flight layer runs, newest first, with the stage each is currently on.
    const runningRows = await db
      .select({
        runId: tenantPipelineRunsTable.id,
        tenantId: tenantPipelineRunsTable.tenantId,
        tenantName: tenantsTable.name,
        layerKey: tenantPipelineRunsTable.layerKey,
        startedAt: tenantPipelineRunsTable.startedAt,
        subStages: tenantPipelineRunsTable.subStages,
      })
      .from(tenantPipelineRunsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, tenantPipelineRunsTable.tenantId))
      .where(eq(tenantPipelineRunsTable.status, "running"))
      .orderBy(desc(tenantPipelineRunsTable.startedAt))
      .limit(50);

    // Recent failed runs, newest first, with the failing stage and the error.
    const failureRows = await db
      .select({
        runId: tenantPipelineRunsTable.id,
        tenantId: tenantPipelineRunsTable.tenantId,
        tenantName: tenantsTable.name,
        layerKey: tenantPipelineRunsTable.layerKey,
        error: tenantPipelineRunsTable.error,
        finishedAt: tenantPipelineRunsTable.finishedAt,
        subStages: tenantPipelineRunsTable.subStages,
      })
      .from(tenantPipelineRunsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, tenantPipelineRunsTable.tenantId))
      .where(eq(tenantPipelineRunsTable.status, "error"))
      .orderBy(desc(tenantPipelineRunsTable.finishedAt))
      .limit(50);

    // The operational alert feed straight from the seam, newest first, with each
    // alert's delivery state so a failed notification is visible, not lost.
    const alertRows = await db
      .select({
        id: alertEventsTable.id,
        type: alertEventsTable.type,
        severity: alertEventsTable.severity,
        tenantId: alertEventsTable.tenantId,
        connectorKey: alertEventsTable.connectorKey,
        entityType: alertEventsTable.entityType,
        entityId: alertEventsTable.entityId,
        message: alertEventsTable.message,
        notificationStatus: alertEventsTable.notificationStatus,
        createdAt: alertEventsTable.createdAt,
      })
      .from(alertEventsTable)
      .orderBy(desc(alertEventsTable.createdAt))
      .limit(50);

    res.json({
      operations: {
        queueDepth,
        inFlightRuns: runningRows.map((r) => ({
          runId: r.runId,
          tenantId: r.tenantId,
          tenantName: r.tenantName ?? null,
          layerKey: r.layerKey,
          startedAt: r.startedAt,
          currentStage: stageWithStatus(r.subStages, "running"),
        })),
        recentFailures: failureRows.map((r) => ({
          runId: r.runId,
          tenantId: r.tenantId,
          tenantName: r.tenantName ?? null,
          layerKey: r.layerKey,
          failingStage: stageWithStatus(r.subStages, "error"),
          error: r.error,
          finishedAt: r.finishedAt,
        })),
        recentAlerts: alertRows.map((r) => ({
          id: r.id,
          type: r.type,
          severity: r.severity,
          tenantId: r.tenantId,
          connectorKey: r.connectorKey,
          entityType: r.entityType,
          entityId: r.entityId,
          message: r.message,
          notificationStatus: r.notificationStatus,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});
