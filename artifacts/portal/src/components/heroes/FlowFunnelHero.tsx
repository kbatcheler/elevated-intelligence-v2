import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend } from "./shared";
import { heroToneInkVar } from "./types";

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
        <div style={{ display: "grid", gap: 6, marginTop: 18, maxWidth: 420 }}>
          {stages.map((m, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span aria-hidden style={{ textAlign: "center", color: "var(--slate-light)", fontSize: 14, lineHeight: 1 }}>
                  &darr;
                </span>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  border: "1px solid var(--cream-dark)",
                  borderRadius: 8,
                  padding: "9px 12px",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--slate)" }}>{m.label}</span>
                <span className="font-mono" style={{ fontSize: 16, fontWeight: 500, color: `var(--${heroToneInkVar(m.tone)})` }}>
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
