import type React from "react";
import { GenericHero } from "./GenericHero";
import type { ArchetypeHeroProps } from "./types";
import { PerformanceScorecardHero } from "./PerformanceScorecardHero";
import { BenchmarkHero } from "./BenchmarkHero";
import { FinancialBridgeHero } from "./FinancialBridgeHero";
import { FlowFunnelHero } from "./FlowFunnelHero";
import { DistributionSentimentHero } from "./DistributionSentimentHero";
import { NetworkFlowHero } from "./NetworkFlowHero";
import { CohortPeopleHero } from "./CohortPeopleHero";
import { TimelineRiskHero } from "./TimelineRiskHero";
import { AgingCollectionHero } from "./AgingCollectionHero";

// The one place archetype display strings map to hero components. Archetype is a
// free string on the registry entry, so an unknown or misspelled value falls
// through to the generic hero rather than crashing. Each archetype morph lives in
// its own file and renders the same skin over different bones, all from real
// persisted fields.
type HeroComponent = (props: ArchetypeHeroProps) => React.ReactElement;

const REGISTRY: Record<string, HeroComponent> = {
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

// The archetype display strings a custom layer may pick, sourced from the same
// REGISTRY the heroes render with, so the owner console dropdown can never offer
// an archetype that would fall through to the generic hero. The server's
// ALLOWED_ARCHETYPES is sync-tested against these same keys.
export const ARCHETYPE_KEYS: string[] = Object.keys(REGISTRY);

export function heroFor(archetype: string | null | undefined): HeroComponent {
  if (archetype && Object.prototype.hasOwnProperty.call(REGISTRY, archetype)) {
    return REGISTRY[archetype];
  }
  return GenericHero;
}
