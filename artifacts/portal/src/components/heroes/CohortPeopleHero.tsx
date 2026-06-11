import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend } from "./shared";
import { heroToneVar } from "./types";

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
        <div
          style={{
            display: "grid",
            gap: 10,
            marginTop: 18,
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          }}
        >
          {cohorts.map((m, i) => (
            <div key={i} style={{ border: "1px solid var(--cream-dark)", borderRadius: 10, padding: "12px 14px" }}>
              <div className="font-mono" style={{ fontSize: 22, fontWeight: 500, color: `var(--${heroToneVar(m.tone)})`, lineHeight: 1.1 }}>
                {m.value}
              </div>
              <div style={{ fontSize: 13, color: "var(--navy)", marginTop: 4 }}>{m.label}</div>
              {m.sub && <div style={{ fontSize: 11, color: "var(--slate-light)", marginTop: 2 }}>{m.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </HeroCard>
  );
}
