import { describe, expect, it } from "vitest";
import { heroFor } from "./registry";
import { GenericHero } from "./GenericHero";
import { PerformanceScorecardHero } from "./PerformanceScorecardHero";
import { BenchmarkHero } from "./BenchmarkHero";
import { FinancialBridgeHero } from "./FinancialBridgeHero";
import { FlowFunnelHero } from "./FlowFunnelHero";
import { DistributionSentimentHero } from "./DistributionSentimentHero";
import { NetworkFlowHero } from "./NetworkFlowHero";
import { CohortPeopleHero } from "./CohortPeopleHero";
import { TimelineRiskHero } from "./TimelineRiskHero";
import { AgingCollectionHero } from "./AgingCollectionHero";

// The archetype strings are the exact values seeded on the layer registry. A
// typo here would silently fall through to the generic hero, so this pins the
// mapping to the real strings.
const EXPECTED: Record<string, unknown> = {
  "Performance scorecard": PerformanceScorecardHero,
  "Performance scorecard, benchmark variant": BenchmarkHero,
  "Financial bridge": FinancialBridgeHero,
  "Flow and funnel": FlowFunnelHero,
  "Distribution and sentiment": DistributionSentimentHero,
  "Network flow map": NetworkFlowHero,
  "Cohort and people": CohortPeopleHero,
  "Timeline and risk": TimelineRiskHero,
  "Aging and collection": AgingCollectionHero,
};

describe("heroFor", () => {
  it("maps every seeded archetype to its own hero", () => {
    for (const [archetype, component] of Object.entries(EXPECTED)) {
      expect(heroFor(archetype)).toBe(component);
    }
  });

  it("maps the nine archetypes to nine distinct components", () => {
    const components = new Set(Object.keys(EXPECTED).map((a) => heroFor(a)));
    expect(components.size).toBe(9);
  });

  it("falls back to the generic hero for unknown or missing archetypes", () => {
    expect(heroFor("Some new archetype")).toBe(GenericHero);
    expect(heroFor("")).toBe(GenericHero);
    expect(heroFor(null)).toBe(GenericHero);
    expect(heroFor(undefined)).toBe(GenericHero);
  });
});
