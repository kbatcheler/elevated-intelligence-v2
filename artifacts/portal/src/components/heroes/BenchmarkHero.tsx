import React from "react";
import type { ArchetypeHeroProps } from "./types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, MiniStat } from "./shared";

// Performance scorecard, benchmark variant: the headline metric and trend, then
// the real peer standings (names and values straight from the persisted
// benchmark, the tenant's own row highlighted). No rank is computed; only the
// cortex's recorded peer values and read are shown. Falls back to a scorecard
// when no benchmark exists.
export function BenchmarkHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Performance scorecard, benchmark variant";
  const peer = detail.peerBenchmark;
  const hasPeers = !!peer && peer.peers.length > 0;
  const tiles = detail.content.metrics.slice(0, 4);

  return (
    <HeroCard accent="gold">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {hasPeers ? (
        <div style={{ marginTop: 18 }}>
          <div className="eyebrow" style={{ color: "var(--slate-light)" }}>
            {peer!.dimension}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {peer!.peers.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: p.is_self ? "var(--navy)" : "var(--cream-dark)",
                  color: p.is_self ? "#fff" : "var(--slate)",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: p.is_self ? 700 : 500 }}>{p.name}</span>
                {p.value && (
                  <span className="font-mono" style={{ fontSize: 13 }}>
                    {p.value}
                    {peer!.unit ? ` ${peer!.unit}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
          {peer!.read && <HeroRead>{peer!.read}</HeroRead>}
        </div>
      ) : (
        tiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            {tiles.map((m, i) => (
              <MiniStat key={i} label={m.label} value={m.value} sub={m.sub} tone={m.tone} />
            ))}
          </div>
        )
      )}
    </HeroCard>
  );
}
