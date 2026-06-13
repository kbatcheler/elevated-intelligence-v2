// Pure analysis for anchor:sweep. No database and no IO: given each tenant's set
// of stated figures, classify them and decide whether any tenant pair or any
// broadcast figure shows a templating signature. Kept separate from the script
// (anchorSweep.ts) so the gate logic is unit-tested without a live database.

// One pass extracts money / percent / multiple / unit figures from free text.
// The non-currency branch requires an explicit unit so bare counts (for example
// "4 layers") are never mistaken for anchor figures.
export const FIGURE_RE =
  /\$\s?\d[\d,.]*\s?(?:bn|billion|mm|m|million|k|thousand|b)?|\d[\d,.]*\s?(?:%|x\b|bps|pts|bn|billion|million|days)/gi;

export function normalizeFigure(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

// A currency figure is the strongest "anchor": a headline money number. Sharing
// one across tenants is the failure signal.
export function isCurrencyAnchor(f: string): boolean {
  return f.startsWith("$");
}

// Significant-figure count of a currency figure, used to tell round headline
// numbers (1-2 sig figs, e.g. $100m, $1.5b) from specific ones (>=3 sig figs,
// e.g. $1.47billion, $587.9m). Round currency figures collide as readily as
// round percentages, so they are benign; a SPECIFIC figure repeating across
// tenants is the real templating signal.
export function currencySignificantFigures(f: string): number {
  let s = f.replace(/^\$/, "").replace(/,/g, "");
  s = s.replace(/(billion|million|thousand|bn|mm|m|k|b)$/i, "");
  if (s.includes(".")) {
    const digits = s.replace(".", "").replace(/^0+/, "");
    return digits.length || 1;
  }
  const trimmed = s.replace(/^0+/, "").replace(/0+$/, "");
  return trimmed.length || 1;
}

export function isSpecificCurrency(f: string): boolean {
  return isCurrencyAnchor(f) && currencySignificantFigures(f) >= 3;
}

export function collectFigures(node: unknown, out: Set<string>): void {
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

export interface TenantFigures {
  name: string;
  figures: Set<string>;
}

export interface TenantSummary {
  name: string;
  distinct: number;
  currency: number;
  specific: number;
  sample: string[];
}

export interface PairFailure {
  a: string;
  b: string;
  shared: string[];
  sharedSpecific: string[];
  ratio: number;
}

export interface Collision {
  figure: string;
  tenants: string[];
}

export interface AnchorAnalysis {
  summaries: TenantSummary[];
  pairFailures: PairFailure[];
  broadcastFailures: Collision[];
  specificCurrencyCollisions: Collision[];
  roundCurrencyCollisions: Collision[];
  otherCollisions: Collision[];
  failed: boolean;
}

// A tenant PAIR fails when it shares two-plus SPECIFIC currency figures (one
// specific figure can be a genuine real-world coincidence; two-plus is the
// statistical signature) or its currency-anchor overlap exceeds OVERLAP_LIMIT of
// the smaller anchor set.
export const OVERLAP_LIMIT = 0.3;
export const SPECIFIC_SHARED_LIMIT = 2;

// A SPECIFIC currency figure stated by BROADCAST_LIMIT or more tenants is a
// templating or leak signature on its own, independent of the pairwise check. A
// figure hardcoded into a prompt necessarily appears in EVERY tenant, so it is
// caught here even when no single pair crosses SPECIFIC_SHARED_LIMIT and the
// overlap stays low. Two tenants sharing one specific figure stay a warning (two
// same-scale firms can genuinely report the same revenue); three or more do not
// plausibly coincide.
export const BROADCAST_LIMIT = 3;

export function analyzeAnchors(perTenant: TenantFigures[]): AnchorAnalysis {
  const summaries: TenantSummary[] = perTenant.map((t) => {
    const currency = [...t.figures].filter(isCurrencyAnchor);
    return {
      name: t.name,
      distinct: t.figures.size,
      currency: currency.length,
      specific: currency.filter(isSpecificCurrency).length,
      sample: currency.slice(0, 8),
    };
  });

  // Index every figure to the tenants that state it.
  const byFigure = new Map<string, Set<string>>();
  for (const t of perTenant) {
    for (const f of t.figures) {
      const set = byFigure.get(f) ?? new Set<string>();
      set.add(t.name);
      byFigure.set(f, set);
    }
  }

  const collisions: Collision[] = [...byFigure.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([figure, names]) => ({ figure, tenants: [...names] }));
  const specificCurrencyCollisions = collisions.filter((c) => isSpecificCurrency(c.figure));
  const roundCurrencyCollisions = collisions.filter(
    (c) => isCurrencyAnchor(c.figure) && !isSpecificCurrency(c.figure),
  );
  const otherCollisions = collisions.filter((c) => !isCurrencyAnchor(c.figure));

  const broadcastFailures = specificCurrencyCollisions.filter(
    (c) => c.tenants.length >= BROADCAST_LIMIT,
  );

  // Currency-anchor set per tenant, for pairwise overlap analysis.
  const currencyByTenant = perTenant.map((t) => ({
    name: t.name,
    currency: new Set([...t.figures].filter(isCurrencyAnchor)),
  }));

  const pairFailures: PairFailure[] = [];
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

  return {
    summaries,
    pairFailures,
    broadcastFailures,
    specificCurrencyCollisions,
    roundCurrencyCollisions,
    otherCollisions,
    failed: pairFailures.length > 0 || broadcastFailures.length > 0,
  };
}
