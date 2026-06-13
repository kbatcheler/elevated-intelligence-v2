import { describe, expect, it } from "vitest";
import {
  analyzeAnchors,
  currencySignificantFigures,
  isSpecificCurrency,
  type TenantFigures,
} from "./anchorAnalysis";

function tenant(name: string, figures: string[]): TenantFigures {
  return { name, figures: new Set(figures) };
}

describe("currencySignificantFigures", () => {
  it("counts round headline numbers as 1-2 significant figures", () => {
    expect(currencySignificantFigures("$100m")).toBe(1);
    expect(currencySignificantFigures("$1.5b")).toBe(2);
  });
  it("counts oddly precise numbers as 3+ significant figures", () => {
    expect(currencySignificantFigures("$1.47billion")).toBe(3);
    expect(currencySignificantFigures("$587.9m")).toBe(4);
  });
});

describe("isSpecificCurrency", () => {
  it("treats >=3 sig-fig currency as specific, round currency and percentages as not", () => {
    expect(isSpecificCurrency("$1.47billion")).toBe(true);
    expect(isSpecificCurrency("$100m")).toBe(false);
    expect(isSpecificCurrency("47%")).toBe(false);
  });
});

describe("analyzeAnchors", () => {
  it("passes when tenants share nothing specific", () => {
    const a = analyzeAnchors([
      tenant("A", ["$12.3m", "$45.6m", "10%"]),
      tenant("B", ["$78.9m", "$2.34b", "20%"]),
    ]);
    expect(a.failed).toBe(false);
    expect(a.pairFailures).toHaveLength(0);
    expect(a.broadcastFailures).toHaveLength(0);
  });

  it("warns but does not fail on a specific figure shared by exactly one pair (real-world coincidence)", () => {
    const a = analyzeAnchors([
      tenant("Patagonia", ["$1.47billion", "$12.3m", "$45.6m", "$78.1m", "$23.4m"]),
      tenant("Hillman", ["$1.47billion", "$65.7m", "$21.9m", "$33.8m", "$49.2m"]),
      tenant("Lattice", ["$98.7m", "$11.2m", "$54.6m", "$87.3m", "$2.34b"]),
    ]);
    expect(a.failed).toBe(false);
    expect(a.broadcastFailures).toHaveLength(0);
    expect(a.pairFailures).toHaveLength(0);
    expect(a.specificCurrencyCollisions.map((c) => c.figure)).toContain("$1.47billion");
  });

  it("fails when a specific figure is broadcast to 3+ tenants even though no pair crosses the pair thresholds", () => {
    const leaked = "$1.47billion";
    const a = analyzeAnchors([
      tenant("A", [leaked, "$12.3m", "$45.6m", "$78.1m", "$23.4m"]),
      tenant("B", [leaked, "$65.7m", "$21.9m", "$33.8m", "$49.2m"]),
      tenant("C", [leaked, "$98.7m", "$11.2m", "$54.6m", "$87.3m"]),
    ]);
    // No pair shares 2+ specific figures and overlap is 1/5 = 20% < 30%, so the
    // pairwise check alone would NOT fail; the broadcast rule is what catches it.
    expect(a.pairFailures).toHaveLength(0);
    expect(a.broadcastFailures.map((c) => c.figure)).toContain(leaked);
    expect(a.broadcastFailures[0].tenants).toHaveLength(3);
    expect(a.failed).toBe(true);
  });

  it("fails a pair that shares two or more specific currency figures", () => {
    const a = analyzeAnchors([
      tenant("A", ["$12.3m", "$45.6m", "$78.1m", "$23.4m", "$56.7m", "$11.2m", "$33.4m"]),
      tenant("B", ["$12.3m", "$45.6m", "$99.9m", "$88.8m", "$77.7m", "$66.6m", "$55.4m"]),
    ]);
    // Shares 2 specific figures; overlap 2/7 = 29% stays under the limit, so this
    // exercises the specific-shared branch on its own.
    expect(a.failed).toBe(true);
    expect(a.pairFailures).toHaveLength(1);
    expect(a.pairFailures[0].sharedSpecific.length).toBeGreaterThanOrEqual(2);
  });

  it("fails a pair on high currency-anchor overlap even when the shared figures are round", () => {
    const a = analyzeAnchors([
      tenant("A", ["$100m", "$200m", "$300m"]),
      tenant("B", ["$100m", "$200m", "$1.5b"]),
    ]);
    expect(a.failed).toBe(true);
    expect(a.pairFailures).toHaveLength(1);
    expect(a.pairFailures[0].sharedSpecific).toHaveLength(0);
  });

  it("does not fail on round currency or percentages shared across all tenants", () => {
    const a = analyzeAnchors([
      tenant("A", ["$100m", "50%", "$1.2m", "$3.1m", "$4.2m", "$5.3m"]),
      tenant("B", ["$100m", "50%", "$7.5m", "$8.6m", "$9.7m", "$2.8m"]),
      tenant("C", ["$100m", "50%", "$11.2m", "$22.3m", "$33.4m", "$44.5m"]),
    ]);
    expect(a.failed).toBe(false);
    expect(a.roundCurrencyCollisions.map((c) => c.figure)).toContain("$100m");
  });
});
