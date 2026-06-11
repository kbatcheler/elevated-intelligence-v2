import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, ToneChip } from "./shared";

// Distribution and sentiment: the headline metric and trend, then the spread of
// signals as tone chips. The distribution shown is the real tone carried by each
// persisted metric; no histogram counts or percentages are fabricated.
export function DistributionSentimentHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Distribution and sentiment";
  const chips = detail.content.metrics.slice(0, 8);

  return (
    <HeroCard accent="amber">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          {chips.map((m, i) => (
            <ToneChip key={i} label={m.label} value={m.value} tone={m.tone} />
          ))}
        </div>
      )}
    </HeroCard>
  );
}
