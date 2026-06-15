import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pipelineJobsTable, tenantsTable } from "@workspace/db";
import { claimNextSeedJob, enqueueSeedLayers, markSeedJob } from "./queue";

// The seed limiter's correctness lives in Postgres, not module memory, so these
// run against a real database. A throwaway tenant owns the jobs; everything is
// deleted afterwards (the tenant FK cascades to its jobs) so the suite is safe
// to run repeatedly.
const RUN = `queue-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let tenantId = "";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  const inserted = await db
    .insert(tenantsTable)
    .values({ name: RUN, url: `https://${RUN}.example.com`, status: "seeding" })
    .returning({ id: tenantsTable.id });
  tenantId = inserted[0]!.id;
});

afterAll(async () => {
  if (tenantId) {
    await db.delete(pipelineJobsTable).where(eq(pipelineJobsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

describe("pipeline_jobs seed queue", () => {
  it("hands every job to exactly one of many concurrent claimers", async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `layer-${i}`);
    await enqueueSeedLayers(tenantId, keys, "full");

    // Five workers drain the same queue at once. FOR UPDATE SKIP LOCKED must
    // give each job to exactly one worker: no double-claim, none dropped.
    async function drain(workerId: string): Promise<string[]> {
      const claimed: string[] = [];
      for (;;) {
        const job = await claimNextSeedJob(tenantId, workerId);
        if (!job) return claimed;
        claimed.push(job.payload.layerKey);
        await markSeedJob(job.id, "done");
      }
    }

    const perWorker = await Promise.all([
      drain("w1"),
      drain("w2"),
      drain("w3"),
      drain("w4"),
      drain("w5"),
    ]);
    const all = perWorker.flat();

    // Every job claimed once, all 20 distinct keys covered, nothing claimed twice.
    expect(all).toHaveLength(keys.length);
    expect(new Set(all).size).toBe(keys.length);
    expect([...all].sort()).toEqual([...keys].sort());

    // The queue is fully drained and every job is terminal.
    const remaining = await db
      .select({ id: pipelineJobsTable.id, status: pipelineJobsTable.status })
      .from(pipelineJobsTable)
      .where(eq(pipelineJobsTable.tenantId, tenantId));
    expect(remaining).toHaveLength(keys.length);
    expect(remaining.every((r) => r.status === "done")).toBe(true);
  });

  it("replaces the tenant queue on re-enqueue (idempotent at the tenant grain)", async () => {
    const keys = ["a", "b", "c"];
    await enqueueSeedLayers(tenantId, keys, "full");
    await enqueueSeedLayers(tenantId, keys, "full");
    const rows = await db
      .select({ id: pipelineJobsTable.id })
      .from(pipelineJobsTable)
      .where(eq(pipelineJobsTable.tenantId, tenantId));
    expect(rows).toHaveLength(keys.length);
  });

  it("reclaims a job whose lease has expired (a crashed worker)", async () => {
    await enqueueSeedLayers(tenantId, ["solo"], "express");

    // Worker A claims with a 1ms lease and then "dies" (never marks the job
    // done). After the lease expires, worker B must be able to reclaim it.
    const a = await claimNextSeedJob(tenantId, "workerA", 1);
    expect(a).not.toBeNull();
    expect(a!.payload.layerKey).toBe("solo");
    expect(a!.payload.mode).toBe("express");

    await sleep(50);

    const b = await claimNextSeedJob(tenantId, "workerB");
    expect(b).not.toBeNull();
    expect(b!.id).toBe(a!.id);

    const row = await db
      .select()
      .from(pipelineJobsTable)
      .where(eq(pipelineJobsTable.id, b!.id))
      .limit(1);
    expect(row[0]!.attempts).toBe(2);
    expect(row[0]!.claimedBy).toBe("workerB");

    await markSeedJob(b!.id, "done");
  });

  it("never double-processes across two simultaneous instances", async () => {
    const keys = Array.from({ length: 40 }, (_, i) => `layer-${i}`);
    await enqueueSeedLayers(tenantId, keys, "full");

    // Two distinct instances, each with its own pool of workers, drain the SAME
    // tenant queue at once. FOR UPDATE SKIP LOCKED guarantees no job is handed to
    // two workers even across instances. There is NO fleet-wide concurrency
    // ceiling: each instance runs up to LAYER_CONCURRENCY claimers, so the global
    // worker count is (instances * LAYER_CONCURRENCY). The cross-instance
    // guarantee proven here is no-double-processing, not a global cap.
    const claimedBy = new Map<string, string>();
    async function worker(instanceId: string, slot: string): Promise<void> {
      const who = `${instanceId}:${slot}`;
      for (;;) {
        const job = await claimNextSeedJob(tenantId, who);
        if (!job) return;
        if (claimedBy.has(job.payload.layerKey)) {
          throw new Error(`layer ${job.payload.layerKey} was claimed twice`);
        }
        claimedBy.set(job.payload.layerKey, who);
        await markSeedJob(job.id, "done");
      }
    }
    function instance(instanceId: string): Promise<unknown> {
      return Promise.all([worker(instanceId, "a"), worker(instanceId, "b"), worker(instanceId, "c")]);
    }
    await Promise.all([instance("instance-1"), instance("instance-2")]);

    // Every layer was claimed exactly once and all keys are covered.
    expect(claimedBy.size).toBe(keys.length);
    expect([...claimedBy.keys()].sort()).toEqual([...keys].sort());

    // The work spread across more than one worker (with 40 jobs and 6 workers a
    // single-worker monopoly is vanishingly unlikely); this evidences genuine
    // concurrent draining rather than a serial run.
    expect(new Set([...claimedBy.values()]).size).toBeGreaterThan(1);

    // The queue is fully drained and every job is terminal.
    const remaining = await db
      .select({ status: pipelineJobsTable.status })
      .from(pipelineJobsTable)
      .where(eq(pipelineJobsTable.tenantId, tenantId));
    expect(remaining).toHaveLength(keys.length);
    expect(remaining.every((r) => r.status === "done")).toBe(true);
  });
});
