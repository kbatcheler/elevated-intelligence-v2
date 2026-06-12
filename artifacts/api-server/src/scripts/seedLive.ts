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
import { eq } from "drizzle-orm";
import { pool, db, tenantsTable, tenantLayersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { seedTenant } from "../lib/pipeline/orchestrator";

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
