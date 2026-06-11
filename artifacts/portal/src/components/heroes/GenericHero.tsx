import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend } from "./shared";

// The fallback hero, and the shared degrade target for every archetype morph.
// With a heroPanel it shows the single generic metric and the capped sparkline,
// the only shape the hero constraint permits. With no heroPanel it degrades to
// the first real content metric, then to the headline finding, never inventing a
// figure or a chart.
export function GenericHero({ entry, detail }: ArchetypeHeroProps) {
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Layer";
  const panel = detail.heroPanel;
  const fallback = !panel ? detail.content.metrics[0] ?? null : null;

  return (
    <HeroCard accent="navy">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        {panel ? (
          <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        ) : fallback ? (
          <HeroBigMetric label={fallback.label} value={fallback.value} sub={fallback.sub} tone={fallback.tone} />
        ) : (
          <div style={{ fontSize: 14, color: "var(--slate)" }}>No headline metric is recorded for this layer yet.</div>
        )}
        {panel && <HeroTrend panel={panel} />}
      </HeroTopRow>
      <HeroRead>{panel?.one_line_read || detail.content.headline_finding}</HeroRead>
    </HeroCard>
  );
}
