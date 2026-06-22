import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow } from "./shared";
import { Sparkline } from "../primitives";

// Timeline and risk: the headline metric, then the trend emphasized as a time
// line with its real point labels as the axis. The line and its labels are the
// persisted trend points only; no dates or events are invented.
export function TimelineRiskHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Timeline and risk";
  const trend = panel.trend.slice(-12);
  const axis = axisLabels(trend.map((p) => p.label));

  return (
    <HeroCard accent="amber">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
      </HeroTopRow>

      {trend.length > 1 && (
        <div className="mt-4">
          <Sparkline points={trend} tone={panel.tone} width={260} height={56} />
          {axis.length > 0 && (
            <div className="flex justify-between w-[260px] mt-1">
              {axis.map((label, i) => (
                <span key={i} className="font-mono text-[10px] text-slate-light">
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>
    </HeroCard>
  );
}

// First, middle and last labels, the honest endpoints of the recorded timeline.
function axisLabels(labels: string[]): string[] {
  const clean = labels.filter((l) => l != null && l !== "");
  if (clean.length === 0) return [];
  if (clean.length <= 2) return clean;
  const mid = clean[Math.floor((clean.length - 1) / 2)];
  return [clean[0], mid, clean[clean.length - 1]];
}
