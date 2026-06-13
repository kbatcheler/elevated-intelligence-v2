// anchor:sweep
//
// Prove the seed data is genuinely distinct across tenants: walk every ready
// tenant's persisted layer content and collect the "anchor figures" it states
// (currency amounts, percentages, multiples and unit figures), then report each
// tenant's figures and flag any templating signature.
//
//   pnpm --filter @workspace/api-server anchor:sweep
//
// Genuinely templated, non-distinct seed data shows a statistical signature: a
// tenant pair sharing several SPECIFIC (>=3 significant-figure) money figures or
// a large fraction of its currency anchors, or a single SPECIFIC figure stated
// by three-plus tenants at once (the broadcast signature a prompt-leaked example
// figure produces, since it then appears in every tenant). Those are the failure
// signals. Independent real companies, by contrast, share only a few round
// numbers ($100m, $1.5b) and the occasional real-world coincidence (two
// same-scale firms reporting the same revenue) - reported as warnings, like
// shared round percentages.
//
// The classification and pass/fail logic lives in anchorAnalysis.ts so it can be
// unit-tested without a live database; this script only reads the data, prints
// the report, and sets the exit code.

import { asc, eq } from "drizzle-orm";
import { pool, db, tenantLayersTable, tenantsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { analyzeAnchors, BROADCAST_LIMIT, collectFigures, type TenantFigures } from "./anchorAnalysis";

async function main(): Promise<void> {
  const tenants = await db
    .select({ id: tenantsTable.id, name: tenantsTable.name, url: tenantsTable.url })
    .from(tenantsTable)
    .where(eq(tenantsTable.status, "ready"))
    .orderBy(asc(tenantsTable.name));

  if (tenants.length === 0) {
    console.log("anchor:sweep: no ready tenants to compare.");
    return;
  }

  const perTenant: TenantFigures[] = [];
  for (const t of tenants) {
    const layers = await db
      .select({
        content: tenantLayersTable.content,
        heroPanel: tenantLayersTable.heroPanel,
        peerBenchmark: tenantLayersTable.peerBenchmark,
        supplementBlocks: tenantLayersTable.supplementBlocks,
      })
      .from(tenantLayersTable)
      .where(eq(tenantLayersTable.tenantId, t.id));

    const figures = new Set<string>();
    for (const layer of layers) {
      collectFigures(layer.content, figures);
      collectFigures(layer.heroPanel, figures);
      collectFigures(layer.peerBenchmark, figures);
      collectFigures(layer.supplementBlocks, figures);
    }
    perTenant.push({ name: t.name, figures });
  }

  const a = analyzeAnchors(perTenant);

  console.log("");
  console.log("================ ANCHOR-FIGURE SWEEP ================");
  for (const s of a.summaries) {
    console.log(
      `${s.name}: ${s.distinct} distinct figures (${s.currency} currency anchors, ${s.specific} specific)`,
    );
    if (s.sample.length > 0) console.log(`    e.g. ${s.sample.join(", ")}`);
  }

  console.log("");
  if (a.broadcastFailures.length > 0) {
    console.log(
      `FAIL: ${a.broadcastFailures.length} specific currency figure(s) stated by ${BROADCAST_LIMIT}+ tenants (broadcast / templating signature):`,
    );
    for (const c of a.broadcastFailures) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
  }
  if (a.pairFailures.length > 0) {
    console.log(`FAIL: ${a.pairFailures.length} tenant pair(s) show a templating signature:`);
    for (const p of a.pairFailures) {
      console.log(
        `    ${p.a} <> ${p.b}: ${p.shared.length} shared currency anchors ` +
          `(${Math.round(p.ratio * 100)}% of smaller set), ` +
          `${p.sharedSpecific.length} specific [${p.sharedSpecific.join(", ") || "none"}]`,
      );
    }
  }
  if (!a.failed) {
    console.log(
      "PASS: no tenant pair and no broadcast figure shows a templating signature (currency anchors are distinct).",
    );
  }

  // A broadcast failure is also a specific collision; report the remaining
  // (two-tenant) specific collisions as warnings to verify by hand.
  const broadcastSet = new Set(a.broadcastFailures.map((c) => c.figure));
  const specificWarn = a.specificCurrencyCollisions.filter((c) => !broadcastSet.has(c.figure));
  if (specificWarn.length > 0) {
    console.log(
      `WARN: ${specificWarn.length} specific currency figure(s) shared by a single pair - verify each is a real-world figure, not templated:`,
    );
    for (const c of specificWarn) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
  }
  if (a.roundCurrencyCollisions.length > 0) {
    console.log(
      `INFO: ${a.roundCurrencyCollisions.length} round currency figure(s) shared (benign, like shared round percentages):`,
    );
    for (const c of a.roundCurrencyCollisions.slice(0, 20)) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
  }
  if (a.otherCollisions.length > 0) {
    console.log(`WARN: ${a.otherCollisions.length} non-currency figure(s) shared (benign overlap):`);
    for (const c of a.otherCollisions.slice(0, 20)) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
  }
  console.log("====================================================");

  if (a.failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "anchor:sweep failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
