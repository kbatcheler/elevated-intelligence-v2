// The pure math of the Portfolio Intelligence view (Phase Y). A portfolio org
// (or a provider seat) ranks every company it holds on one board, surfaces the
// gap patterns that recur across the portfolio, and links into each company's
// full diagnosis. Every figure here is computed from already-persisted state and
// handed in by the route; nothing is invented. Where a figure cannot be honestly
// computed (a company with no numeric prediction, or no generated layer yet) the
// value is null, never a fabricated zero or a fabricated "value at risk".
//
// The honesty boundary worth stating plainly: there is NO persisted dollar
// "value at risk" anywhere in the schema. The closest honest figure is the value
// a company has IDENTIFIED (the sum of its committed actions' numeric
// predictions) minus what it has REALIZED (the sum of the latest measurement per
// action). That difference, unrealizedValueUsd, is the value still on the table;
// it is null when the company has no numeric prediction to stand on, so the board
// shows a dash rather than inventing a risk number the schema cannot back.

import { round2, type OutcomeSummary } from "../outcomes/outcomeMath";

export type GapSeverity = "high" | "medium" | "low";
export type PortfolioScopeType = "provider" | "portfolio";
export type PortfolioGapKind = "DATA" | "SIGNAL" | "INTEG" | "MODEL" | "FLOW" | null;

// The severity of an open gap, derived solely from the confidence lift in
// percentage points that closing it would buy (the one persisted, comparable
// number a stored gap carries). A bigger lift is a more material gap. A gap with
// no quantified lift is the least severe by this measure, never a fabricated
// high. Bands: 20pp or more is high, 10pp or more is medium, anything else
// (including an absent or non-finite lift) is low.
export function deriveGapSeverity(confidenceLiftPp: number | null): GapSeverity {
  if (confidenceLiftPp === null || !Number.isFinite(confidenceLiftPp)) return "low";
  if (confidenceLiftPp >= 20) return "high";
  if (confidenceLiftPp >= 10) return "medium";
  return "low";
}

export interface PortfolioLayerGapInput {
  kind: PortfolioGapKind;
  description: string | null;
  confidenceLiftPp: number | null;
}

export interface PortfolioLayerInput {
  layerKey: string;
  layerName: string;
  // True when the cortex has generated content for this layer for this tenant.
  generated: boolean;
  // The layer's overall confidence (0 to 100), or null when not generated or
  // when the stored value is malformed.
  confidence: number | null;
  gaps: PortfolioLayerGapInput[];
}

export interface PortfolioTenantInput {
  tenantId: string;
  tenantName: string;
  status: string;
  dataMode: string;
  layers: PortfolioLayerInput[];
  // The already-computed outcome summary for this tenant (computeOutcomeSummary
  // over its committed actions and their measurements).
  outcomes: OutcomeSummary;
  // Phase AK: the tenant's Data Efficacy rollup (mean of its generated layers'
  // indices), or null when no layer has been generated. Optional so a caller
  // that has not computed efficacy still type-checks; absent reads as null (an
  // honest dash on the board), never a fabricated zero.
  efficacyScore?: number | null;
  efficacyLayers?: number;
}

export interface OpenGapCounts {
  total: number;
  high: number;
  medium: number;
  low: number;
  // A single comparable weight for ranking: high counts treble, medium double,
  // low single. Derived, deterministic, and never shown as a dollar figure.
  severityScore: number;
}

export interface PortfolioCompleteness {
  hasLayerContent: boolean;
  hasOutcomes: boolean;
  // Which inputs are absent, so the board can say honestly what a company is
  // missing rather than implying a zero. A subset of "layer_content","outcomes".
  missing: string[];
}

export interface PortfolioTenantMetrics {
  tenantId: string;
  tenantName: string;
  status: string;
  dataMode: string;
  generatedLayers: number;
  totalLayers: number;
  // Sum of numeric predictions across committed, non-dismissed actions, or null
  // when the company has no numeric prediction at all (honest absence).
  valueIdentifiedUsd: number | null;
  // Sum of the latest realized value per measured action, or null when nothing
  // has been measured.
  valueRealizedUsd: number | null;
  // valueIdentifiedUsd minus what has been realized, the value still on the
  // table. Null when there is no numeric prediction to stand on.
  unrealizedValueUsd: number | null;
  // Mean of the per-layer confidence across generated layers, or null when no
  // layer has been generated. confidenceLayers is how many contributed.
  overallConfidence: number | null;
  confidenceLayers: number;
  // Phase AK: the tenant's Data Efficacy rollup (mean of its generated layers'
  // 0-100 indices), or null when no layer has been generated. efficacyLayers is
  // how many contributed. A null score sorts last in the efficacy ranking.
  efficacyScore: number | null;
  efficacyLayers: number;
  openGaps: OpenGapCounts;
  completeness: PortfolioCompleteness;
}

export interface RankedPortfolioTenant extends PortfolioTenantMetrics {
  rank: number;
  // The company's standing when the board is ranked by data efficacy (1 is the
  // best-fuelled). A null efficacy score ranks last; the company name is the
  // stable tiebreak. This is a SEPARATE ordering from the value-based rank, so a
  // user can read "who has the most value on the table" and "whose diagnosis
  // rests on the best data" without one masquerading as the other.
  efficacyRank: number;
}

export interface CommonGapPattern {
  layerKey: string;
  layerName: string;
  kind: PortfolioGapKind;
  // How many distinct companies in the portfolio carry this (layer, kind) gap,
  // out of the total in scope, plus the share as a fraction in [0,1].
  affectedTenants: number;
  totalTenants: number;
  share: number;
  // The strongest severity seen across the contributing gaps.
  severity: GapSeverity;
  // The contributing companies, sorted, and up to three distinct example
  // descriptions so the pattern is concrete rather than abstract.
  tenantIds: string[];
  examples: string[];
}

export interface PortfolioTotals {
  tenantCount: number;
  valueIdentifiedUsd: number | null;
  valueRealizedUsd: number | null;
  unrealizedValueUsd: number | null;
  openGaps: OpenGapCounts;
  tenantsWithLayerContent: number;
  tenantsWithOutcomes: number;
}

export interface PortfolioScope {
  type: PortfolioScopeType;
  orgId: string | null;
  orgName: string | null;
}

export interface PortfolioSummary {
  scope: PortfolioScope;
  totals: PortfolioTotals;
  tenants: RankedPortfolioTenant[];
  patterns: CommonGapPattern[];
}

function countGaps(layers: readonly PortfolioLayerInput[]): OpenGapCounts {
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const layer of layers) {
    for (const gap of layer.gaps) {
      const sev = deriveGapSeverity(gap.confidenceLiftPp);
      if (sev === "high") high += 1;
      else if (sev === "medium") medium += 1;
      else low += 1;
    }
  }
  return { total: high + medium + low, high, medium, low, severityScore: high * 3 + medium * 2 + low };
}

export function computeTenantPortfolioMetrics(input: PortfolioTenantInput): PortfolioTenantMetrics {
  const generated = input.layers.filter((l) => l.generated);
  const confidences = generated
    .map((l) => l.confidence)
    .filter((c): c is number => c !== null && Number.isFinite(c));
  const overallConfidence =
    confidences.length > 0
      ? round2(confidences.reduce((sum, c) => sum + c, 0) / confidences.length)
      : null;

  const hasPrediction = input.outcomes.actionsWithPrediction > 0;
  const hasMeasured = input.outcomes.actionsMeasured > 0;
  const valueIdentifiedUsd = hasPrediction ? input.outcomes.valueIdentifiedUsd : null;
  const valueRealizedUsd = hasMeasured ? input.outcomes.valueRealizedUsd : null;
  const unrealizedValueUsd =
    valueIdentifiedUsd === null ? null : round2(valueIdentifiedUsd - (valueRealizedUsd ?? 0));

  const hasLayerContent = generated.length > 0;
  const hasOutcomes = hasPrediction || hasMeasured;
  const missing: string[] = [];
  if (!hasLayerContent) missing.push("layer_content");
  if (!hasOutcomes) missing.push("outcomes");

  const efficacyScore =
    input.efficacyScore !== undefined && input.efficacyScore !== null && Number.isFinite(input.efficacyScore)
      ? input.efficacyScore
      : null;

  return {
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    status: input.status,
    dataMode: input.dataMode,
    generatedLayers: generated.length,
    totalLayers: input.layers.length,
    valueIdentifiedUsd,
    valueRealizedUsd,
    unrealizedValueUsd,
    overallConfidence,
    confidenceLayers: confidences.length,
    efficacyScore,
    efficacyLayers: input.efficacyLayers ?? 0,
    openGaps: countGaps(input.layers),
    completeness: { hasLayerContent, hasOutcomes, missing },
  };
}

// Rank the portfolio by data efficacy: the best-fuelled company leads. A company
// with no generated layer (efficacy null) sorts last regardless; the company
// name is the stable final tiebreak. Returned as a map from tenant id to its
// efficacy rank so the value-ordered board can carry the second ordering without
// reordering itself.
function efficacyRanks(metrics: readonly PortfolioTenantMetrics[]): Map<string, number> {
  const sorted = [...metrics].sort((a, b) => {
    const ae = a.efficacyScore;
    const be = b.efficacyScore;
    if (ae === null && be !== null) return 1;
    if (ae !== null && be === null) return -1;
    if (ae !== null && be !== null && ae !== be) return be - ae;
    return a.tenantName.localeCompare(b.tenantName);
  });
  const ranks = new Map<string, number>();
  sorted.forEach((m, i) => ranks.set(m.tenantId, i + 1));
  return ranks;
}

// Rank the portfolio: the company with the most value still on the table leads.
// A company with no numeric prediction (unrealized null) sorts last regardless,
// since there is no figure to rank it by; the open-gap severity then breaks ties,
// and the company name is the final, stable tiebreak so the order is
// deterministic.
export function rankPortfolio(metrics: readonly PortfolioTenantMetrics[]): RankedPortfolioTenant[] {
  const effRanks = efficacyRanks(metrics);
  const sorted = [...metrics].sort((a, b) => {
    const au = a.unrealizedValueUsd;
    const bu = b.unrealizedValueUsd;
    if (au === null && bu !== null) return 1;
    if (au !== null && bu === null) return -1;
    if (au !== null && bu !== null && au !== bu) return bu - au;
    if (a.openGaps.severityScore !== b.openGaps.severityScore) {
      return b.openGaps.severityScore - a.openGaps.severityScore;
    }
    return a.tenantName.localeCompare(b.tenantName);
  });
  return sorted.map((m, i) => ({ ...m, rank: i + 1, efficacyRank: effRanks.get(m.tenantId) ?? i + 1 }));
}

const SEVERITY_RANK: Record<GapSeverity, number> = { high: 3, medium: 2, low: 1 };

// The cross-portfolio gap patterns: a (layer, kind) gap that recurs across two
// or more companies, ranked by how widespread and how severe it is. This is the
// "6 of 9 companies have broken CRM hygiene" read. A pattern is only reported
// when at least two companies share it, so a single company's own gaps are left
// to its drill-down rather than dressed up as a portfolio-wide pattern. A
// single-company portfolio therefore yields no patterns, and the board shows an
// honest empty state instead of a one-company "pattern".
export function detectCommonGapPatterns(
  tenants: readonly { tenantId: string; layers: readonly PortfolioLayerInput[] }[],
): CommonGapPattern[] {
  const totalTenants = tenants.length;

  interface Group {
    layerKey: string;
    layerName: string;
    kind: PortfolioGapKind;
    tenantIds: Set<string>;
    examples: string[];
    maxLift: number | null;
  }
  const groups = new Map<string, Group>();

  for (const tenant of tenants) {
    for (const layer of tenant.layers) {
      for (const gap of layer.gaps) {
        const key = `${layer.layerKey}::${gap.kind ?? "UNKNOWN"}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            layerKey: layer.layerKey,
            layerName: layer.layerName,
            kind: gap.kind,
            tenantIds: new Set(),
            examples: [],
            maxLift: null,
          };
          groups.set(key, g);
        }
        g.tenantIds.add(tenant.tenantId);
        if (gap.description && !g.examples.includes(gap.description) && g.examples.length < 3) {
          g.examples.push(gap.description);
        }
        if (gap.confidenceLiftPp !== null && Number.isFinite(gap.confidenceLiftPp)) {
          g.maxLift = g.maxLift === null ? gap.confidenceLiftPp : Math.max(g.maxLift, gap.confidenceLiftPp);
        }
      }
    }
  }

  const patterns: CommonGapPattern[] = [];
  for (const g of groups.values()) {
    const affectedTenants = g.tenantIds.size;
    if (affectedTenants < 2) continue;
    patterns.push({
      layerKey: g.layerKey,
      layerName: g.layerName,
      kind: g.kind,
      affectedTenants,
      totalTenants,
      share: totalTenants > 0 ? round2(affectedTenants / totalTenants) : 0,
      severity: deriveGapSeverity(g.maxLift),
      tenantIds: [...g.tenantIds].sort(),
      examples: g.examples,
    });
  }

  patterns.sort((a, b) => {
    if (a.affectedTenants !== b.affectedTenants) return b.affectedTenants - a.affectedTenants;
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    return a.layerName.localeCompare(b.layerName);
  });
  return patterns;
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return null;
  return round2(present.reduce((sum, v) => sum + v, 0));
}

function totalGaps(metrics: readonly PortfolioTenantMetrics[]): OpenGapCounts {
  const acc: OpenGapCounts = { total: 0, high: 0, medium: 0, low: 0, severityScore: 0 };
  for (const m of metrics) {
    acc.total += m.openGaps.total;
    acc.high += m.openGaps.high;
    acc.medium += m.openGaps.medium;
    acc.low += m.openGaps.low;
    acc.severityScore += m.openGaps.severityScore;
  }
  return acc;
}

// The one entry point the route calls: turn the per-tenant inputs into the ranked
// board, the portfolio totals, and the cross-portfolio gap patterns. Pure and
// deterministic over its inputs, so it unit-tests without a database or request,
// and it carries NO synthetic top-level timestamp (a "computed just now" field
// would be the only unpersisted number on the surface).
export function summarizePortfolio(
  scope: PortfolioScope,
  tenants: readonly PortfolioTenantInput[],
): PortfolioSummary {
  const metrics = tenants.map(computeTenantPortfolioMetrics);
  const ranked = rankPortfolio(metrics);
  const totals: PortfolioTotals = {
    tenantCount: metrics.length,
    valueIdentifiedUsd: sumOrNull(metrics.map((m) => m.valueIdentifiedUsd)),
    valueRealizedUsd: sumOrNull(metrics.map((m) => m.valueRealizedUsd)),
    unrealizedValueUsd: sumOrNull(metrics.map((m) => m.unrealizedValueUsd)),
    openGaps: totalGaps(metrics),
    tenantsWithLayerContent: metrics.filter((m) => m.completeness.hasLayerContent).length,
    tenantsWithOutcomes: metrics.filter((m) => m.completeness.hasOutcomes).length,
  };
  const patterns = detectCommonGapPatterns(
    tenants.map((t) => ({ tenantId: t.tenantId, layers: t.layers })),
  );
  return { scope, totals, tenants: ranked, patterns };
}
