// seed:demo
//
// Bring the four demo tenants to ready, idempotently. A tenant already at
// status "ready" is skipped with no model spend at all (we never even re-run the
// profile stage for it); a missing or partially built tenant is seeded with the
// full nine-stage chain, resuming from whatever was already persisted. Tenants
// are seeded one at a time, never in parallel: stacked seeds are the surest way
// to collect 429s from the model providers.
//
//   pnpm --filter @workspace/api-server seed:demo
//
// Re-running after a clean pass prints "already seeded" for all four and spends
// nothing.

import { pool, db, tenantsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { seedTenant } from "../lib/pipeline/orchestrator";

// The demo set: four distinct real companies at distinct scales, so no anchor
// figure is shared across them (proven by anchor:sweep). Patagonia is usually
// already seeded from an earlier phase and will be skipped.
const DEMO_TENANTS: ReadonlyArray<{ name: string; url: string }> = [
  { name: "Hillman Solutions", url: "https://www.hillmangroup.com" },
  { name: "Lattice", url: "https://lattice.com" },
  { name: "Hinge Health", url: "https://www.hingehealth.com" },
  { name: "Patagonia", url: "https://www.patagonia.com" },
];

// Match tenants by host, ignoring a leading www, so a demo listed as
// lattice.com matches a row stored as https://www.lattice.com and we never
// double-seed the same company under a second row.
function normalizeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

type Outcome =
  | { name: string; action: "skipped"; reason: string }
  | { name: string; action: "seeded"; elapsedMs: number; built: number; skipped: number; errored: number }
  | { name: string; action: "failed"; elapsedMs: number; reason: string };

async function main(): Promise<void> {
  // Snapshot existing tenants once, keyed by normalized host, so the idempotency
  // check is a pure lookup with no per-tenant round trip.
  const existing = await db
    .select({ url: tenantsTable.url, status: tenantsTable.status, name: tenantsTable.name })
    .from(tenantsTable);
  const byHost = new Map(existing.map((t) => [normalizeHost(t.url), t] as const));

  const outcomes: Outcome[] = [];

  for (const demo of DEMO_TENANTS) {
    const host = normalizeHost(demo.url);
    const present = byHost.get(host);
    if (present && present.status === "ready") {
      logger.info({ name: demo.name, url: demo.url }, "seed:demo already seeded, skipping");
      outcomes.push({ name: demo.name, action: "skipped", reason: "already ready" });
      continue;
    }

    logger.info({ name: demo.name, url: demo.url }, "seed:demo seeding tenant (full)");
    const started = Date.now();
    try {
      const result = await seedTenant(demo.url, { log: logger, mode: "full" });
      const elapsedMs = Date.now() - started;
      const built = result.layers.filter((l) => l.status === "built").length;
      const skipped = result.layers.filter((l) => l.status === "skipped").length;
      const errored = result.layers.filter((l) => l.status === "error").length;
      outcomes.push({ name: demo.name, action: "seeded", elapsedMs, built, skipped, errored });
    } catch (e) {
      const elapsedMs = Date.now() - started;
      const reason = e instanceof Error ? e.message : String(e);
      logger.error({ name: demo.name, reason }, "seed:demo tenant failed");
      outcomes.push({ name: demo.name, action: "failed", elapsedMs, reason });
    }
  }

  console.log("");
  console.log("================ SEED:DEMO SUMMARY ================");
  let anyFailure = false;
  for (const o of outcomes) {
    if (o.action === "skipped") {
      console.log(`[skip]   ${o.name.padEnd(20)} ${o.reason}`);
    } else if (o.action === "seeded") {
      const secs = (o.elapsedMs / 1000).toFixed(1);
      console.log(
        `[seed]   ${o.name.padEnd(20)} ${secs}s  ${o.built} built, ${o.skipped} skipped, ${o.errored} error`,
      );
      if (o.errored > 0) anyFailure = true;
    } else {
      const secs = (o.elapsedMs / 1000).toFixed(1);
      console.log(`[FAIL]   ${o.name.padEnd(20)} ${secs}s  ${o.reason}`);
      anyFailure = true;
    }
  }
  console.log("==================================================");

  if (anyFailure) process.exitCode = 1;
}

main()
  .catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "seed:demo failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
