// F6 live-seed driver
//
// One-shot, resumable driver for the Phase F live seed. Run inside a managed
// workflow (NOT a bash background job, which is reaped after a few minutes): it
// seeds the three new demo tenants and records real full and express timings.
//
// Order (per the binding architect ruling): express-seed ONE new tenant first
// (cheap, yields the express timing), then full-seed the other two strictly
// SEQUENTIALLY (stacked seeds are the binding 429 risk), then refresh the
// express tenant up to a full build. Patagonia is already ready and is skipped.
//
// Resumable: every step skips a tenant already at status "ready", and the final
// upgrade only runs while the express tenant still carries reduced layers, so a
// restart never re-spends on completed work.
//
//   LAYER_CONCURRENCY=2 pnpm --filter @workspace/api-server exec tsx src/scripts/seedLive.ts

import { writeFileSync } from "node:fs";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  pool,
  db,
  forecastsTable,
  tenantsTable,
  tenantLayersTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { seedTenant } from "../lib/pipeline/orchestrator";
import { commitRecommendedAction } from "../lib/outcomes/commitAction";
import { recordOutcomeMeasurement } from "../lib/outcomes/recordMeasurement";
import { loadRecommendationSnapshot } from "../lib/decisions/decisionRecord";

const RESULTS_PATH = "/tmp/f6_results.json";

const HILLMAN = "https://www.hillmangroup.com";
const LATTICE = "https://lattice.com";
const HINGE = "https://www.hingehealth.com";

function normalizeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

interface Timing {
  label: string;
  tenant: string;
  mode: "full" | "express";
  seconds: number;
  built: number;
  reduced: number;
  errored: number;
}

async function tenantByHost(host: string): Promise<{ id: string; status: string } | undefined> {
  const rows = await db
    .select({ id: tenantsTable.id, url: tenantsTable.url, status: tenantsTable.status })
    .from(tenantsTable);
  const match = rows.find((r) => normalizeHost(r.url) === host);
  return match ? { id: match.id, status: match.status } : undefined;
}

async function reducedLayerCount(tenantId: string): Promise<number> {
  const rows = await db
    .select({ reducedMode: tenantLayersTable.reducedMode })
    .from(tenantLayersTable)
    .where(eq(tenantLayersTable.tenantId, tenantId));
  return rows.filter((r) => r.reducedMode).length;
}

async function seedAndTime(
  label: string,
  url: string,
  mode: "full" | "express",
  timings: Timing[],
): Promise<void> {
  logger.info({ label, url, mode }, "seed:live step starting");
  const t0 = Date.now();
  const res = await seedTenant(url, { log: logger, mode });
  const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  const built = res.layers.filter((l) => l.status === "built").length;
  const reduced = res.layers.filter((l) => l.reduced).length;
  const errored = res.layers.filter((l) => l.status === "error").length;
  timings.push({ label, tenant: res.name, mode, seconds, built, reduced, errored });
  logger.info({ label, seconds, built, reduced, errored }, "seed:live step done");
}

// Close ONE outcome loop on a tenant from real pipeline state, so the demo
// carries an end-to-end closed loop: a real recommendation committed, the
// action_outcome forecast it bound, and a graded resolution with a Brier score.
// Idempotent: skips once the tenant already has a resolved action_outcome
// forecast bound to a committed action, and skips entirely when no open unbound
// forecast names a real action carrying a parseable dollar prediction. The
// realised value is the prediction itself, recorded on a MODELLED basis (no
// scalar signal backs it) and honestly noted as seeded; it never claims a
// measured outcome.
async function closeOneLoop(tenantId: string): Promise<void> {
  const alreadyClosed = await db
    .select({ id: forecastsTable.id })
    .from(forecastsTable)
    .where(
      and(
        eq(forecastsTable.tenantId, tenantId),
        eq(forecastsTable.kind, "action_outcome"),
        isNotNull(forecastsTable.committedActionId),
        isNotNull(forecastsTable.resolvedAt),
      ),
    )
    .limit(1);
  if (alreadyClosed.length > 0) {
    logger.info({}, "seed:live outcome loop already closed, skipping");
    return;
  }

  const ownerRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "provider-owner"))
    .limit(1);
  const ownerId = ownerRows[0]?.id;
  if (!ownerId) {
    logger.info({}, "seed:live no provider-owner user, skipping outcome loop");
    return;
  }

  const candidates = await db
    .select({
      id: forecastsTable.id,
      layerKey: forecastsTable.layerKey,
      sourcePath: forecastsTable.sourcePath,
    })
    .from(forecastsTable)
    .where(
      and(
        eq(forecastsTable.tenantId, tenantId),
        eq(forecastsTable.kind, "action_outcome"),
        isNull(forecastsTable.committedActionId),
        isNull(forecastsTable.resolvedAt),
        isNotNull(forecastsTable.sourcePath),
      ),
    )
    .orderBy(desc(forecastsTable.madeAt))
    .limit(10);

  for (const c of candidates) {
    const sourcePath = c.sourcePath;
    if (!sourcePath) continue;
    // Verify the forecast names a REAL action in the live layer content, read
    // server-side, and skip anything that no longer resolves to an action.
    const loaded = await loadRecommendationSnapshot(tenantId, c.layerKey, sourcePath);
    if (loaded.kind !== "ok") continue;
    const snap = loaded.snapshot;
    // Only a recommendation carrying a parseable dollar prediction can be closed
    // with a modelled realised-equals-predicted outcome; otherwise the realised
    // value would be a fabricated figure, so skip it.
    if (snap.predictedValueUsd === null) continue;

    const committed = await commitRecommendedAction({
      tenantId,
      committedBy: ownerId,
      layerKey: c.layerKey,
      title: snap.title,
      detail: snap.detail,
      predictedImpact: snap.impact,
      basis: snap.basis === "verified" ? "verified" : "modelled",
      confidence: snap.confidence,
      actionRef: sourcePath,
      forecastSourcePath: sourcePath,
      rationale: "Seeded demo commit to close one outcome loop end to end.",
    });
    if (!committed.ok) {
      logger.info({ reason: committed.reason, sourcePath }, "seed:live commit skipped, trying next candidate");
      continue;
    }

    const measured = await recordOutcomeMeasurement({
      tenantId,
      actionId: committed.action.id,
      recordedBy: ownerId,
      realizedValueUsd: snap.predictedValueUsd,
      final: true,
      note: "Seeded modelled demo outcome",
    });
    if (!measured.ok) {
      logger.info({ reason: measured.reason }, "seed:live measurement failed on seeded loop");
      return;
    }
    logger.info(
      { actionId: committed.action.id, resolvedForecasts: measured.resolvedForecasts },
      "seed:live outcome loop closed",
    );
    return;
  }
  logger.info({}, "seed:live no eligible open forecast to close, skipping outcome loop");
}

async function main(): Promise<void> {
  const timings: Timing[] = [];

  // 1. Express-seed Hillman first (yields the express build timing).
  const hill1 = await tenantByHost("hillmangroup.com");
  if (!hill1 || hill1.status !== "ready") {
    await seedAndTime("hillman-express", HILLMAN, "express", timings);
  } else {
    logger.info({}, "seed:live hillman already ready, skipping express");
  }

  // 2. Full-seed Lattice (full timing).
  const lat = await tenantByHost("lattice.com");
  if (!lat || lat.status !== "ready") {
    await seedAndTime("lattice-full", LATTICE, "full", timings);
  } else {
    logger.info({}, "seed:live lattice already ready, skipping");
  }

  // 3. Full-seed Hinge Health (full timing).
  const hinge = await tenantByHost("hingehealth.com");
  if (!hinge || hinge.status !== "ready") {
    await seedAndTime("hinge-full", HINGE, "full", timings);
  } else {
    logger.info({}, "seed:live hinge already ready, skipping");
  }

  // 4. Upgrade the express tenant to a full build (express->full timing). Only
  //    runs while Hillman still carries reduced layers, so a re-run is a no-op.
  const hill2 = await tenantByHost("hillmangroup.com");
  if (hill2) {
    const reduced = await reducedLayerCount(hill2.id);
    if (reduced > 0) {
      await seedAndTime("hillman-upgrade-full", HILLMAN, "full", timings);
    } else {
      logger.info({}, "seed:live hillman already full (0 reduced layers), skipping upgrade");
    }
  }

  // 5. Close one outcome loop on Hillman from real pipeline state, so the demo
  //    carries an end-to-end closed loop. Idempotent and a no-op once closed.
  const hill3 = await tenantByHost("hillmangroup.com");
  if (hill3) {
    await closeOneLoop(hill3.id);
  }

  writeFileSync(RESULTS_PATH, JSON.stringify(timings, null, 2));
  console.log("");
  console.log("================ F6 LIVE SEED TIMINGS ================");
  for (const t of timings) {
    console.log(
      `${t.label.padEnd(22)} ${t.mode.padEnd(8)} ${String(t.seconds).padStart(8)}s  built=${t.built} ` +
        `reduced=${t.reduced} err=${t.errored}  [${t.tenant}]`,
    );
  }
  console.log("=====================================================");
  console.log(`results written to ${RESULTS_PATH}`);
}

main()
  .catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "seed:live failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
