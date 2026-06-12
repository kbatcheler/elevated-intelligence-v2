// anchor:sweep
//
// Prove the seed data is genuinely distinct across tenants: walk every ready
// tenant's persisted layer content and collect the "anchor figures" it states
// (currency amounts, percentages, multiples and unit figures), then report each
// tenant's figures and flag any figure shared across tenants.
//
//   pnpm --filter @workspace/api-server anchor:sweep
//
// Genuinely templated, non-distinct seed data shows a statistical signature: a
// large fraction of shared currency anchors and several shared SPECIFIC (>=3
// significant-figure) money figures. That is the failure signal. Independent
// real companies, by contrast, share only a few round numbers ($100m, $1.5b)
// and the occasional real-world coincidence (two same-scale firms reporting the
// same revenue) - reported as warnings, like shared round percentages.

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

// Significant-figure count of a currency figure, used to tell round headline
// numbers (1-2 sig figs, e.g. $100m, $1.5b) from specific ones (>=3 sig figs,
// e.g. $1.47billion, $587.9m). Round currency figures collide as readily as
// round percentages, so they are benign; a SPECIFIC figure repeating across
// tenants is the real templating signal.
function currencySignificantFigures(f: string): number {
  let s = f.replace(/^\$/, "").replace(/,/g, "");
  s = s.replace(/(billion|million|thousand|bn|mm|m|k|b)$/i, "");
  if (s.includes(".")) {
    const digits = s.replace(".", "").replace(/^0+/, "");
    return digits.length || 1;
  }
  const trimmed = s.replace(/^0+/, "").replace(/0+$/, "");
  return trimmed.length || 1;
}

function isSpecificCurrency(f: string): boolean {
  return isCurrencyAnchor(f) && currencySignificantFigures(f) >= 3;
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

  // Currency-anchor set per tenant, for pairwise overlap analysis.
  const currencyByTenant = perTenant.map((t) => ({
    name: t.name,
    currency: new Set([...t.figures].filter(isCurrencyAnchor)),
  }));

  console.log("");
  console.log("================ ANCHOR-FIGURE SWEEP ================");
  for (const t of perTenant) {
    const currency = [...t.figures].filter(isCurrencyAnchor);
    const specific = currency.filter(isSpecificCurrency).length;
    console.log(
      `${t.name}: ${t.figures.size} distinct figures (${currency.length} currency anchors, ${specific} specific)`,
    );
    const sample = currency.slice(0, 8);
    if (sample.length > 0) console.log(`    e.g. ${sample.join(", ")}`);
  }

  const collisions = [...byFigure.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([figure, names]) => ({ figure, tenants: [...names] }));
  const specificCurrencyCollisions = collisions.filter((c) => isSpecificCurrency(c.figure));
  const roundCurrencyCollisions = collisions.filter(
    (c) => isCurrencyAnchor(c.figure) && !isSpecificCurrency(c.figure),
  );
  const otherCollisions = collisions.filter((c) => !isCurrencyAnchor(c.figure));

  // Templating fails a tenant PAIR, not a single figure: either the pair shares
  // two-plus SPECIFIC currency figures (one specific figure can be a genuine
  // real-world coincidence; two-plus is the statistical signature), or its
  // currency-anchor overlap exceeds OVERLAP_LIMIT of the smaller anchor set.
  const OVERLAP_LIMIT = 0.3;
  const SPECIFIC_SHARED_LIMIT = 2;
  const pairFailures: Array<{
    a: string;
    b: string;
    shared: string[];
    sharedSpecific: string[];
    ratio: number;
  }> = [];
  for (let i = 0; i < currencyByTenant.length; i++) {
    for (let j = i + 1; j < currencyByTenant.length; j++) {
      const A = currencyByTenant[i];
      const B = currencyByTenant[j];
      const shared = [...A.currency].filter((f) => B.currency.has(f));
      if (shared.length === 0) continue;
      const sharedSpecific = shared.filter(isSpecificCurrency);
      const smaller = Math.min(A.currency.size, B.currency.size) || 1;
      const ratio = shared.length / smaller;
      if (sharedSpecific.length >= SPECIFIC_SHARED_LIMIT || ratio > OVERLAP_LIMIT) {
        pairFailures.push({ a: A.name, b: B.name, shared, sharedSpecific, ratio });
      }
    }
  }

  console.log("");
  if (pairFailures.length > 0) {
    console.log(`FAIL: ${pairFailures.length} tenant pair(s) show a templating signature:`);
    for (const p of pairFailures) {
      console.log(
        `    ${p.a} <> ${p.b}: ${p.shared.length} shared currency anchors ` +
          `(${Math.round(p.ratio * 100)}% of smaller set), ` +
          `${p.sharedSpecific.length} specific [${p.sharedSpecific.join(", ") || "none"}]`,
      );
    }
  } else {
    console.log("PASS: no tenant pair shows a templating signature (currency anchors are distinct).");
  }

  if (specificCurrencyCollisions.length > 0) {
    console.log(
      `WARN: ${specificCurrencyCollisions.length} specific currency figure(s) shared - verify each is a real-world figure, not templated:`,
    );
    for (const c of specificCurrencyCollisions) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
  }
  if (roundCurrencyCollisions.length > 0) {
    console.log(
      `INFO: ${roundCurrencyCollisions.length} round currency figure(s) shared (benign, like shared round percentages):`,
    );
    for (const c of roundCurrencyCollisions.slice(0, 20)) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
  }
  if (otherCollisions.length > 0) {
    console.log(`WARN: ${otherCollisions.length} non-currency figure(s) shared (benign overlap):`);
    for (const c of otherCollisions.slice(0, 20)) console.log(`    ${c.figure} <- ${c.tenants.join(", ")}`);
  }
  console.log("====================================================");

  if (pairFailures.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "anchor:sweep failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
