import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, heroToneInkText } from "./shared";

// Cohort and people: the headline metric and trend, then the leading metrics as
// value-first cohort tiles with their descriptor underneath. Every value and
// descriptor is a real persisted metric field.
export function CohortPeopleHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Cohort and people";
  const cohorts = detail.content.metrics.slice(0, 6);

  return (
    <HeroCard accent="teal">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {cohorts.length > 0 && (
        <div className="grid gap-2.5 mt-[18px] [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
          {cohorts.map((m, i) => (
            <div key={i} className="border border-cream-dark rounded-[10px] py-3 px-3.5">
              <div className={`font-mono text-[22px] font-medium leading-[1.1] ${heroToneInkText[m.tone]}`}>
                {m.value}
              </div>
              <div className="text-caption text-navy mt-1">{m.label}</div>
              {m.sub && <div className="text-meta text-slate-light mt-0.5">{m.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </HeroCard>
  );
}
