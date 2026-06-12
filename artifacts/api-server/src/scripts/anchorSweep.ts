// anchor:sweep
//
// Prove the seed data is genuinely distinct across tenants: walk every ready
// tenant's persisted layer content and collect the "anchor figures" it states
// (currency amounts, percentages, multiples and unit figures), then report each
// tenant's figures and flag any figure shared across tenants.
//
//   pnpm --filter @workspace/api-server anchor:sweep
//
// A collision on a currency anchor (a shared headline money figure such as a
// revenue number) is treated as a failure: it is the signature of templated,
// non-distinct seed data. Shared percentages or multiples are reported as
// warnings only, since independent companies can legitimately land on the same
// round percentage.

import { asc, eq } from "drizzle-orm";
import { pool, db, tenantLayersTable, tenantsTable } from "@workspace/db";
import { logger } from "../lib/logger";

// One pass extracts money / percent / multiple / unit figures from free text.
// The non-currency branch requires an explicit unit so bare counts (for example
// "4 layers") are never mistaken for anchor figures.
const FIGURE_RE =
  /\$\s?\d[\d,.]*\s?(?:bn|billion|mm|m|million|k|thousand|b)?|\d[\d,.]*\s?(?:%|x\b|bps|pts|bn|billion|million|days)/gi;

function normalizeFigure(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

// A currency figure is the strongest "anchor": a headline money number. Sharing
// one across tenants is the failure signal.
function isCurrencyAnchor(f: string): boolean {
  return f.startsWith("$");
}

function collectFigures(node: unknown, out: Set<string>): void {
  if (node == null) return;
  if (typeof node === "string") {
    const matches = node.match(FIGURE_RE);
    if (matches) for (const m of matches) out.add(normalizeFigure(m));
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectFigures(v, out);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) collectFigures(v, out);
  }
}

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

  const perTenant: Array<{ name: string; figures: Set<string> }> = [];

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

  // Index every figure to the tenants that state it.
  const byFigure = new Map<string, Set<string>>();
  for (const t of perTenant) {
    for (const f of t.figures) {
      const set = byFigure.get(f) ?? new Set<string>();
      set.add(t.name);
      byFigure.set(f, set);
    }
  }

  console.log("");
  console.log("================ ANCHOR-FIGURE SWEEP ================");
  for (const t of perTenant) {
    const currency = [...t.figures].filter(isCurrencyAnchor);
    console.log(`${t.name}: ${t.figures.size} distinct figures (${currency.length} currency anchors)`);
    const sample = currency.slice(0, 8);
    if (sample.length > 0) console.log(`    e.g. ${sample.join(", ")}`);
  }

  const collisions = [...byFigure.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([figure, names]) => ({ figure, tenants: [...names] }));
  const currencyCollisions = collisions.filter((c) => isCurrencyAnchor(c.figure));
  const otherCollisions = collisions.filter((c) => !isCurrencyAnchor(c.figure));

  console.log("");
  if (collisions.length === 0) {
    console.log("PASS: no figure is shared across tenants. Anchors are fully distinct.");
  } else {
    if (currencyCollisions.length > 0) {
      console.log(`FAIL: ${currencyCollisions.length} currency anchor(s) shared across tenants:`);
      for (const c of currencyCollisions) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
    } else {
      console.log("PASS: no currency anchor is shared across tenants.");
    }
    if (otherCollisions.length > 0) {
      console.log(`WARN: ${otherCollisions.length} non-currency figure(s) shared (benign overlap):`);
      for (const c of otherCollisions.slice(0, 20)) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
    }
  }
  console.log("====================================================");

  if (currencyCollisions.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "anchor:sweep failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
