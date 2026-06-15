import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { FlowArrow, HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, MiniStat } from "./shared";

// Financial bridge: the headline figure and trend, then the leading metrics laid
// left to right as a bridge of real values, with the recorded lever as the
// caption. The bridge is the sequence of persisted metrics, not a computed
// waterfall: no bar heights or deltas are invented.
export function FinancialBridgeHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Financial bridge";
  const steps = detail.content.metrics.slice(0, 4);

  return (
    <HeroCard accent="teal">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {steps.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 8, marginTop: 18 }}>
          {steps.map((m, i) => (
            <React.Fragment key={i}>
              {i > 0 && <FlowArrow />}
              <MiniStat label={m.label} value={m.value} sub={m.sub} tone={m.tone} />
            </React.Fragment>
          ))}
        </div>
      )}

      {detail.content.headline_lever && (
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--slate)" }}>
          <span className="eyebrow" style={{ color: "var(--teal-ink)", marginRight: 8 }}>
            Lever
          </span>
          {detail.content.headline_lever}
        </div>
      )}
    </HeroCard>
  );
}
