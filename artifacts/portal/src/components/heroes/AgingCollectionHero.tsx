import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend } from "./shared";
import { heroToneVar, heroToneInkVar } from "./types";

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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          {buckets.map((m, i) => (
            <div
              key={i}
              style={{
                flex: "1 1 110px",
                minWidth: 100,
                borderTop: `3px solid var(--${heroToneVar(m.tone)})`,
                background: "var(--cream-dark)",
                borderRadius: "0 0 8px 8px",
                padding: "10px 12px",
              }}
            >
              <div className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10 }}>
                {m.label}
              </div>
              <div className="font-mono" style={{ fontSize: 18, fontWeight: 500, color: `var(--${heroToneInkVar(m.tone)})` }}>
                {m.value}
              </div>
              {m.sub && <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>{m.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </HeroCard>
  );
}
