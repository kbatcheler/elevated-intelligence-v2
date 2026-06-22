import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, heroToneInkText, heroToneTopBorder } from "./shared";

// Aging and collection: the headline metric and trend, then the leading metrics
// as aging buckets, each topped by its tone color. The buckets are the real
// persisted metrics; no bucket boundaries or balances are computed.
export function AgingCollectionHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Aging and collection";
  const buckets = detail.content.metrics.slice(0, 6);

  return (
    <HeroCard accent="coral">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {buckets.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-[18px]">
          {buckets.map((m, i) => (
            <div
              key={i}
              className={`flex-[1_1_110px] min-w-[100px] border-t-[3px] bg-cream-dark rounded-b-lg py-2.5 px-3 ${heroToneTopBorder[m.tone]}`}
            >
              <div className="eyebrow text-slate-light text-[10px]">{m.label}</div>
              <div className={`font-mono text-[18px] font-medium ${heroToneInkText[m.tone]}`}>
                {m.value}
              </div>
              {m.sub && <div className="text-meta text-slate-base mt-0.5">{m.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </HeroCard>
  );
}
