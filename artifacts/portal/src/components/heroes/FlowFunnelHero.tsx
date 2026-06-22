import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend } from "./shared";
import type { Tone } from "../../types";

// The AA-passing ink colour class per tone for the stage value, indexed by the
// metric tone so the colour stays data-driven without inline style.
const stageValueClass: Record<Tone, string> = {
  good: "text-teal-ink",
  warn: "text-amber-ink",
  bad: "text-coral-ink",
  neutral: "text-navy",
};

// Flow and funnel: the headline metric and trend, then the leading metrics
// stacked as ordered stages with downward connectors. The stages are the real
// persisted metrics in their stored order; no conversion rate is computed.
export function FlowFunnelHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Flow and funnel";
  const stages = detail.content.metrics.slice(0, 5);

  return (
    <HeroCard accent="navy">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {stages.length > 1 && (
        <div className="grid gap-1.5 mt-[18px] max-w-[420px]">
          {stages.map((m, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span aria-hidden className="text-center text-slate-light text-[14px] leading-none">
                  &darr;
                </span>
              )}
              <div className="flex items-baseline justify-between gap-3 border border-cream-dark rounded-lg py-[9px] px-3">
                <span className="text-caption text-slate-base">{m.label}</span>
                <span className={`font-mono text-[16px] font-medium ${stageValueClass[m.tone]}`}>
                  {m.value}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </HeroCard>
  );
}
