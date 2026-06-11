// seed:tenant <url>
//
// Seed ONE real tenant end to end through the three-model cortex and print the
// live per-seat telemetry. This is the Phase C gate: it proves the genuine
// Confounder and the grounded seats actually ran against a real company.
//
//   pnpm --filter @workspace/api-server seed:tenant https://www.example.com

import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { seedTenant } from "../lib/pipeline/orchestrator";

function fmt(n: number | undefined): string {
  return n === undefined ? "-" : String(n);
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: seed:tenant <url>");
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  const result = await seedTenant(url, { log: logger });
  const totalMs = Date.now() - started;

  const built = result.layers.filter((l) => l.status === "built").length;
  const skipped = result.layers.filter((l) => l.status === "skipped").length;
  const errored = result.layers.filter((l) => l.status === "error");

  console.log("");
  console.log("================ SEED COMPLETE ================");
  console.log(`tenant:   ${result.name}`);
  console.log(`tenantId: ${result.tenantId}`);
  console.log(`url:      ${result.url}`);
  console.log(`layers:   ${built} built, ${skipped} skipped, ${errored.length} error (of ${result.layers.length})`);
  console.log(`elapsed:  ${(totalMs / 1000).toFixed(1)}s`);
  console.log(
    `profile:  seat=${result.profileTelemetry.seat} model=${result.profileTelemetry.model} latencyMs=${fmt(
      result.profileTelemetry.latencyMs,
    )}`,
  );

  console.log("");
  console.log("---- per-seat telemetry (stage / seat / model / latencyMs / searchCalls) ----");
  for (const layer of result.layers) {
    if (layer.status === "skipped") {
      console.log(`[${layer.layerKey}] skipped (already built)`);
      continue;
    }
    console.log(`[${layer.layerKey}] ${layer.status}${layer.reason ? `: ${layer.reason}` : ""}`);
    for (const t of layer.telemetry) {
      console.log(
        `    ${t.stage.padEnd(12)} ${String(t.seat ?? "-").padEnd(12)} ${String(t.model ?? "-").padEnd(20)} ${fmt(
          t.latencyMs,
        ).padStart(7)}ms  search=${fmt(t.searchCalls)}`,
      );
    }
  }

  if (errored.length > 0) {
    console.log("");
    console.log(`FAILED layers: ${errored.map((l) => `${l.layerKey} (${l.reason})`).join("; ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "seed:tenant failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
