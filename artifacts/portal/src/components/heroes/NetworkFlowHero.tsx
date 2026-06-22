import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { FlowArrow, HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, MiniStat } from "./shared";

// Network flow map: the headline metric and trend, then the real source feeds
// drawn as input nodes flowing into this layer. The map is the registry's actual
// feed list, not invented nodes or edge weights. Falls back to a metric strip
// when no feeds are registered.
export function NetworkFlowHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Network flow map";
  const feeds = entry?.feeds ?? [];
  const tiles = detail.content.metrics.slice(0, 4);

  return (
    <HeroCard accent="navy">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {feeds.length > 0 ? (
        <div className="flex items-center gap-3.5 mt-[18px] flex-wrap">
          <div className="grid gap-1.5">
            {feeds.map((f, i) => (
              <span key={i} className="tag tag-data justify-start">
                {f}
              </span>
            ))}
          </div>
          <FlowArrow />
          <span className="font-serif text-[16px] font-bold text-cream-light bg-navy rounded-[10px] py-2.5 px-4">
            {name}
          </span>
        </div>
      ) : (
        tiles.length > 0 && (
          <div className="flex flex-wrap gap-2.5 mt-[18px]">
            {tiles.map((m, i) => (
              <MiniStat key={i} label={m.label} value={m.value} sub={m.sub} tone={m.tone} />
            ))}
          </div>
        )
      )}
    </HeroCard>
  );
}
