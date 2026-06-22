import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, MiniStat } from "./shared";

// Performance scorecard: the headline metric and trend, then a compact row of
// the leading content metrics as a scorecard. Every value is a real persisted
// metric; nothing is summed or derived.
export function PerformanceScorecardHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Performance scorecard";
  const tiles = detail.content.metrics.slice(0, 4);

  return (
    <HeroCard accent="navy">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>
      {tiles.length > 0 && (
        <div className="flex flex-wrap gap-2.5 mt-[18px]">
          {tiles.map((m, i) => (
            <MiniStat key={i} label={m.label} value={m.value} sub={m.sub} tone={m.tone} />
          ))}
        </div>
      )}
    </HeroCard>
  );
}
