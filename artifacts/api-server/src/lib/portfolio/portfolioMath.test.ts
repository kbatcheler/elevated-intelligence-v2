import { describe, expect, it } from "vitest";
import type { OutcomeSummary } from "../outcomes/outcomeMath";
import {
  computeTenantPortfolioMetrics,
  detectCommonGapPatterns,
  deriveGapSeverity,
  rankPortfolio,
  summarizePortfolio,
  type PortfolioLayerInput,
  type PortfolioScope,
  type PortfolioTenantInput,
} from "./portfolioMath";

function outcome(partial: Partial<OutcomeSummary>): OutcomeSummary {
  return {
    valueIdentifiedUsd: 0,
    valueRealizedUsd: 0,
    actionsWithPrediction: 0,
    actionsMeasured: 0,
    calibration: { score: null, hits: 0, misses: 0, resolved: 0 },
    ...partial,
  };
}

function layer(partial: Partial<PortfolioLayerInput> & { layerKey: string }): PortfolioLayerInput {
  return {
    layerName: partial.layerKey,
    generated: true,
    confidence: null,
    gaps: [],
    ...partial,
  };
}

function tenant(partial: Partial<PortfolioTenantInput> & { tenantId: string }): PortfolioTenantInput {
  return {
    tenantName: partial.tenantId,
    status: "ready",
    dataMode: "outside_in",
    layers: [],
    outcomes: outcome({}),
    ...partial,
  };
}

const SCOPE: PortfolioScope = { type: "portfolio", orgId: "org-1", orgName: "Holdings" };

describe("deriveGapSeverity", () => {
  it("treats an absent or non-finite lift as low, never a fabricated high", () => {
    expect(deriveGapSeverity(null)).toBe("low");
    expect(deriveGapSeverity(Number.NaN)).toBe("low");
    expect(deriveGapSeverity(Number.POSITIVE_INFINITY)).toBe("low");
  });

  it("bands on 10 and 20 percentage points", () => {
    expect(deriveGapSeverity(0)).toBe("low");
    expect(deriveGapSeverity(9.99)).toBe("low");
    expect(deriveGapSeverity(10)).toBe("medium");
    expect(deriveGapSeverity(19.99)).toBe("medium");
    expect(deriveGapSeverity(20)).toBe("high");
    expect(deriveGapSeverity(75)).toBe("high");
  });
});

describe("computeTenantPortfolioMetrics", () => {
  it("means confidence across generated layers and counts gaps by severity", () => {
    const m = computeTenantPortfolioMetrics(
      tenant({
        tenantId: "t1",
        layers: [
          layer({
            layerKey: "a",
            confidence: 80,
            gaps: [
              { kind: "INTEG", description: "g1", confidenceLiftPp: 25 },
              { kind: "DATA", description: "g2", confidenceLiftPp: 12 },
            ],
          }),
          layer({ layerKey: "b", confidence: 60, gaps: [{ kind: "FLOW", description: "g3", confidenceLiftPp: 5 }] }),
          layer({ layerKey: "c", generated: false, confidence: null }),
        ],
        outcomes: outcome({
          valueIdentifiedUsd: 100000,
          valueRealizedUsd: 40000,
          actionsWithPrediction: 2,
          actionsMeasured: 1,
        }),
      }),
    );
    expect(m.generatedLayers).toBe(2);
    expect(m.totalLayers).toBe(3);
    expect(m.overallConfidence).toBe(70);
    expect(m.confidenceLayers).toBe(2);
    expect(m.openGaps).toEqual({ total: 3, high: 1, medium: 1, low: 1, severityScore: 6 });
    expect(m.valueIdentifiedUsd).toBe(100000);
    expect(m.valueRealizedUsd).toBe(40000);
    expect(m.unrealizedValueUsd).toBe(60000);
    expect(m.completeness).toEqual({ hasLayerContent: true, hasOutcomes: true, missing: [] });
  });

  it("returns null figures, never zeros, for a company with no content and no outcomes", () => {
    const m = computeTenantPortfolioMetrics(
      tenant({ tenantId: "t2", layers: [layer({ layerKey: "a", generated: false, confidence: null })] }),
    );
    expect(m.overallConfidence).toBeNull();
    expect(m.confidenceLayers).toBe(0);
    expect(m.valueIdentifiedUsd).toBeNull();
    expect(m.valueRealizedUsd).toBeNull();
    expect(m.unrealizedValueUsd).toBeNull();
    expect(m.completeness).toEqual({
      hasLayerContent: false,
      hasOutcomes: false,
      missing: ["layer_content", "outcomes"],
    });
  });

  it("treats unmeasured-but-predicted as fully unrealized", () => {
    const m = computeTenantPortfolioMetrics(
      tenant({
        tenantId: "t3",
        outcomes: outcome({ valueIdentifiedUsd: 50000, actionsWithPrediction: 1 }),
      }),
    );
    expect(m.valueIdentifiedUsd).toBe(50000);
    expect(m.valueRealizedUsd).toBeNull();
    expect(m.unrealizedValueUsd).toBe(50000);
  });
});

describe("rankPortfolio", () => {
  it("ranks by value on the table descending, with no-prediction companies last", () => {
    const ranked = rankPortfolio([
      computeTenantPortfolioMetrics(tenant({ tenantId: "low", outcomes: outcome({ valueIdentifiedUsd: 50, actionsWithPrediction: 1 }) })),
      computeTenantPortfolioMetrics(tenant({ tenantId: "none" })),
      computeTenantPortfolioMetrics(tenant({ tenantId: "high", outcomes: outcome({ valueIdentifiedUsd: 100, actionsWithPrediction: 1 }) })),
    ]);
    expect(ranked.map((r) => r.tenantId)).toEqual(["high", "low", "none"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties by gap severity then name", () => {
    const a = computeTenantPortfolioMetrics(
      tenant({ tenantId: "alpha", layers: [layer({ layerKey: "l", gaps: [{ kind: "DATA", description: "x", confidenceLiftPp: 5 }] })] }),
    );
    const b = computeTenantPortfolioMetrics(
      tenant({ tenantId: "bravo", layers: [layer({ layerKey: "l", gaps: [{ kind: "DATA", description: "x", confidenceLiftPp: 25 }] })] }),
    );
    const c = computeTenantPortfolioMetrics(
      tenant({ tenantId: "charlie", layers: [layer({ layerKey: "l", gaps: [{ kind: "DATA", description: "x", confidenceLiftPp: 25 }] })] }),
    );
    // All three have null unrealized, so severity (bravo and charlie high=3) leads, then name.
    const ranked = rankPortfolio([a, b, c]);
    expect(ranked.map((r) => r.tenantId)).toEqual(["bravo", "charlie", "alpha"]);
  });
});

describe("detectCommonGapPatterns", () => {
  it("reports a (layer, kind) gap shared by two or more companies", () => {
    const patterns = detectCommonGapPatterns([
      { tenantId: "t1", layers: [layer({ layerKey: "crm", layerName: "CRM hygiene", gaps: [{ kind: "INTEG", description: "no sync", confidenceLiftPp: 30 }] })] },
      { tenantId: "t2", layers: [layer({ layerKey: "crm", layerName: "CRM hygiene", gaps: [{ kind: "INTEG", description: "stale fields", confidenceLiftPp: 12 }] })] },
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      layerKey: "crm",
      kind: "INTEG",
      affectedTenants: 2,
      totalTenants: 2,
      share: 1,
      severity: "high",
    });
    expect(patterns[0].tenantIds).toEqual(["t1", "t2"]);
    expect(patterns[0].examples).toEqual(["no sync", "stale fields"]);
  });

  it("does not report a single-company gap as a pattern", () => {
    const patterns = detectCommonGapPatterns([
      { tenantId: "solo", layers: [layer({ layerKey: "crm", gaps: [{ kind: "INTEG", description: "x", confidenceLiftPp: 30 }] })] },
    ]);
    expect(patterns).toEqual([]);
  });

  it("groups by both layer and kind, leaving one-off groups out", () => {
    const patterns = detectCommonGapPatterns([
      {
        tenantId: "t1",
        layers: [
          layer({ layerKey: "crm", gaps: [{ kind: "INTEG", description: "a", confidenceLiftPp: 30 }] }),
          layer({ layerKey: "fin", gaps: [{ kind: "DATA", description: "b", confidenceLiftPp: 30 }] }),
        ],
      },
      { tenantId: "t2", layers: [layer({ layerKey: "crm", gaps: [{ kind: "INTEG", description: "c", confidenceLiftPp: 5 }] })] },
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ layerKey: "crm", kind: "INTEG", affectedTenants: 2 });
  });
});

describe("summarizePortfolio", () => {
  it("returns honest nulls and an empty board for an empty portfolio", () => {
    const summary = summarizePortfolio(SCOPE, []);
    expect(summary.scope).toEqual(SCOPE);
    expect(summary.tenants).toEqual([]);
    expect(summary.patterns).toEqual([]);
    expect(summary.totals).toEqual({
      tenantCount: 0,
      valueIdentifiedUsd: null,
      valueRealizedUsd: null,
      unrealizedValueUsd: null,
      openGaps: { total: 0, high: 0, medium: 0, low: 0, severityScore: 0 },
      tenantsWithLayerContent: 0,
      tenantsWithOutcomes: 0,
    });
  });

  it("sums dollar totals only over companies that carry a figure", () => {
    const summary = summarizePortfolio(SCOPE, [
      tenant({
        tenantId: "t1",
        layers: [layer({ layerKey: "crm", confidence: 70, gaps: [{ kind: "INTEG", description: "x", confidenceLiftPp: 30 }] })],
        outcomes: outcome({ valueIdentifiedUsd: 100000, valueRealizedUsd: 40000, actionsWithPrediction: 2, actionsMeasured: 1 }),
      }),
      tenant({
        tenantId: "t2",
        layers: [layer({ layerKey: "crm", confidence: 50, gaps: [{ kind: "INTEG", description: "y", confidenceLiftPp: 15 }] })],
        outcomes: outcome({ valueIdentifiedUsd: 20000, actionsWithPrediction: 1 }),
      }),
      tenant({ tenantId: "t3" }),
    ]);
    expect(summary.totals.tenantCount).toBe(3);
    expect(summary.totals.valueIdentifiedUsd).toBe(120000);
    expect(summary.totals.valueRealizedUsd).toBe(40000);
    expect(summary.totals.unrealizedValueUsd).toBe(80000);
    expect(summary.totals.tenantsWithLayerContent).toBe(2);
    expect(summary.totals.tenantsWithOutcomes).toBe(2);
    expect(summary.tenants[0].tenantId).toBe("t1");
    expect(summary.tenants[0].rank).toBe(1);
    expect(summary.patterns).toHaveLength(1);
    expect(summary.patterns[0]).toMatchObject({ layerKey: "crm", kind: "INTEG", affectedTenants: 2 });
  });
});
