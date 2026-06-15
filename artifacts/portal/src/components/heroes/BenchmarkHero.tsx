import React from "react";
import type { ArchetypeHeroProps } from "./types";
import type { CohortBenchmark, CohortLock, CohortMetric } from "../../types";
import { GenericHero } from "./GenericHero";
import { HeroBigMetric, HeroCard, HeroHead, HeroRead, HeroTopRow, HeroTrend, MiniStat } from "./shared";

// Performance scorecard, benchmark variant. When the tenant has opted in and its
// segment has cleared the k-anonymity floor, the headline metric sits above a
// real verified-cohort distribution: percentile bands (p25 to p75 with a p50
// marker) computed across de-identified peers, the tenant's OWN value positioned
// within each band. There are no peer names and no peer values, only the bands
// and the tenant's own marker. While the cohort is still forming it shows an
// honest lock with the live count. With neither, it falls back to the modelled
// peerBenchmark (named, source-backed) and then to the metric tiles.
export function BenchmarkHero({ entry, detail }: ArchetypeHeroProps) {
  if (!detail.heroPanel) return <GenericHero entry={entry} detail={detail} />;
  const panel = detail.heroPanel;
  const name = entry?.name ?? detail.layerKey;
  const archetype = entry?.archetype ?? "Performance scorecard, benchmark variant";
  const peer = detail.peerBenchmark;
  const hasPeers = !!peer && peer.peers.length > 0;
  const cohort = detail.cohortBenchmark;
  const lock = detail.cohortLock;
  const tiles = detail.content.metrics.slice(0, 4);

  return (
    <HeroCard accent="gold">
      <HeroHead archetype={archetype} name={name} />
      <HeroTopRow>
        <HeroBigMetric label={panel.metric_label} value={panel.metric_value} sub={panel.metric_sub} tone={panel.tone} />
        <HeroTrend panel={panel} />
      </HeroTopRow>
      <HeroRead>{panel.one_line_read || detail.content.headline_finding}</HeroRead>

      {cohort && cohort.metrics.length > 0 ? (
        <VerifiedCohort cohort={cohort} />
      ) : lock ? (
        <CohortLockView lock={lock} />
      ) : hasPeers ? (
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

function fmtNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function signalLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "verified" | "muted" }) {
  const isVerified = tone === "verified";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: isVerified ? "var(--teal)" : "var(--slate-light)",
        background: isVerified ? "rgba(0, 128, 128, 0.10)" : "var(--cream-dark)",
        border: isVerified ? "1px solid rgba(0, 128, 128, 0.30)" : "1px solid transparent",
      }}
    >
      {children}
    </span>
  );
}

// The verified-cohort distribution: a de-identified percentile band per metric
// with the tenant's own value placed on it. No peer identity, no peer value.
function VerifiedCohort({ cohort }: { cohort: CohortBenchmark }) {
  const anyNoised = cohort.metrics.some((m) => m.noised);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill tone="verified">Verified cohort</Pill>
        <span style={{ fontSize: 12, color: "var(--slate-light)" }}>
          {cohort.sector} {"\u00b7"} {cohort.revenueBand}
        </span>
      </div>
      <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
        {cohort.metrics.map((m, i) => (
          <DistributionBand key={i} metric={m} />
        ))}
      </div>
      {anyNoised && (
        <div style={{ fontSize: 11, color: "var(--slate-light)", marginTop: 10 }}>
          Privacy protected: bounded noise is applied to the smallest cohorts, so the bands are
          directional rather than exact.
        </div>
      )}
    </div>
  );
}

function DistributionBand({ metric }: { metric: CohortMetric }) {
  const { p25, p50, p75, self } = metric;
  // Place the real values on the cohort's own min-to-max range. This positions
  // genuine figures on an axis; it never invents a value that is not present.
  const points = [p25, p50, p75, ...(self != null ? [self] : [])];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - lo) / span) * 100));
  const left = pct(p25);
  const mid = pct(p50);
  const right = pct(p75);
  const selfPct = self != null ? pct(self) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)", textTransform: "capitalize" }}>
          {signalLabel(metric.signalKey)}
          {metric.window ? (
            <span style={{ fontWeight: 400, color: "var(--slate-light)" }}> {"\u00b7"} {metric.window}</span>
          ) : null}
        </span>
        <span style={{ fontSize: 11, color: "var(--slate-light)" }}>{metric.sampleCount} peers</span>
      </div>

      <div style={{ position: "relative", height: 12, marginTop: 8 }}>
        <div
          style={{
            position: "absolute",
            top: 5,
            left: 0,
            right: 0,
            height: 2,
            background: "var(--cream-dark)",
            borderRadius: 2,
          }}
        />
        {/* The p25 to p75 interquartile band. */}
        <div
          style={{
            position: "absolute",
            top: 3,
            left: `${left}%`,
            width: `${Math.max(0, right - left)}%`,
            height: 6,
            background: "rgba(0, 128, 128, 0.25)",
            borderRadius: 4,
          }}
        />
        {/* The p50 median marker. */}
        <div
          style={{ position: "absolute", top: 0, left: `${mid}%`, width: 2, height: 12, background: "var(--teal)" }}
          title="Cohort median (p50)"
        />
        {/* The tenant's own value, the only identified point and it is theirs. */}
        {selfPct != null && (
          <div
            style={{
              position: "absolute",
              top: -2,
              left: `calc(${selfPct}% - 5px)`,
              width: 10,
              height: 16,
              borderRadius: 3,
              background: "var(--navy)",
              border: "2px solid #fff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
            }}
            title="Your value"
          />
        )}
      </div>

      <div
        className="font-mono"
        style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--slate)", marginTop: 6 }}
      >
        <span>p25 {fmtNumber(p25)}</span>
        <span>p50 {fmtNumber(p50)}</span>
        <span>p75 {fmtNumber(p75)}</span>
        <span style={{ color: self != null ? "var(--navy)" : "var(--slate-light)", fontWeight: 600 }}>
          {self != null ? `you ${fmtNumber(self)}` : "you n/a"}
        </span>
      </div>
    </div>
  );
}

// Below the k floor: an honest, current count, never a fabricated distribution.
function CohortLockView({ lock }: { lock: CohortLock }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill tone="muted">Cohort forming</Pill>
        <span style={{ fontSize: 12, color: "var(--slate-light)" }}>
          {lock.sector} {"\u00b7"} {lock.revenueBand}
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        <div
          className="font-mono"
          style={{ fontSize: 13, color: "var(--navy)", fontWeight: 600 }}
        >
          {lock.currentCount} of {lock.unlocksAt}
        </div>
        <div
          style={{
            marginTop: 6,
            height: 6,
            background: "var(--cream-dark)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(100, (lock.currentCount / Math.max(1, lock.unlocksAt)) * 100)}%`,
              height: "100%",
              background: "var(--amber)",
            }}
          />
        </div>
      </div>
      <HeroRead>
        Your verified peer benchmark unlocks once at least {lock.unlocksAt} opted-in companies share
        your segment. {lock.currentCount} {lock.currentCount === 1 ? "is" : "are"} in so far, and no
        distribution is shown until the floor is reached.
      </HeroRead>
    </div>
  );
}
