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
        <div className="mt-[18px]">
          <div className="eyebrow text-slate-light">{peer!.dimension}</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {peer!.peers.map((p, i) => (
              <div
                key={i}
                className={`inline-flex items-baseline gap-2 py-2 px-3 rounded-full ${
                  p.is_self ? "bg-navy text-cream-light" : "bg-cream-dark text-slate-base"
                }`}
              >
                <span className={`text-xs ${p.is_self ? "font-bold" : "font-medium"}`}>{p.name}</span>
                {p.value && (
                  <span className="font-mono text-caption">
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
          <div className="flex flex-wrap gap-2.5 mt-[18px]">
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
      className={`inline-flex items-center py-[3px] px-[9px] rounded-full text-meta font-semibold tracking-[0.2px] ${
        isVerified
          ? "text-teal-ink bg-teal-faint border border-teal"
          : "text-slate-light bg-cream-dark border border-transparent"
      }`}
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
    <div className="mt-[18px]">
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="verified">Verified cohort</Pill>
        <span className="text-xs text-slate-light">
          {cohort.sector} {"\u00b7"} {cohort.revenueBand}
        </span>
      </div>
      <div className="grid gap-3.5 mt-3">
        {cohort.metrics.map((m, i) => (
          <DistributionBand key={i} metric={m} />
        ))}
      </div>
      {anyNoised && (
        <div className="text-meta text-slate-light mt-2.5">
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
      <div className="flex justify-between items-baseline">
        <span className="text-caption font-semibold text-navy capitalize">
          {signalLabel(metric.signalKey)}
          {metric.window ? (
            <span className="font-normal text-slate-light"> {"\u00b7"} {metric.window}</span>
          ) : null}
        </span>
        <span className="text-meta text-slate-light">{metric.sampleCount} peers</span>
      </div>

      <div className="relative h-3 mt-2">
        <div className="absolute top-[5px] left-0 right-0 h-0.5 bg-cream-dark rounded-[2px]" />
        {/* The p25 to p75 interquartile band. */}
        <div
          className="absolute top-[3px] h-1.5 bg-teal-faint rounded"
          style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
        />
        {/* The p50 median marker. */}
        <div
          className="absolute top-0 w-0.5 h-3 bg-teal"
          style={{ left: `${mid}%` }}
          title="Cohort median (p50)"
        />
        {/* The tenant's own value, the only identified point and it is theirs. */}
        {selfPct != null && (
          <div
            className="absolute -top-0.5 w-2.5 h-4 rounded-[3px] bg-navy border-2 border-paper"
            style={{ left: `calc(${selfPct}% - 5px)` }}
            title="Your value"
          />
        )}
      </div>

      <div className="font-mono flex justify-between text-meta text-slate-base mt-1.5">
        <span>p25 {fmtNumber(p25)}</span>
        <span>p50 {fmtNumber(p50)}</span>
        <span>p75 {fmtNumber(p75)}</span>
        <span className={`font-semibold ${self != null ? "text-navy" : "text-slate-light"}`}>
          {self != null ? `you ${fmtNumber(self)}` : "you n/a"}
        </span>
      </div>
    </div>
  );
}

// Below the k floor: an honest, current count, never a fabricated distribution.
function CohortLockView({ lock }: { lock: CohortLock }) {
  return (
    <div className="mt-[18px]">
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="muted">Cohort forming</Pill>
        <span className="text-xs text-slate-light">
          {lock.sector} {"\u00b7"} {lock.revenueBand}
        </span>
      </div>
      <div className="mt-2.5">
        <div className="font-mono text-caption text-navy font-semibold">
          {lock.currentCount} of {lock.unlocksAt}
        </div>
        <div className="mt-1.5 h-1.5 bg-cream-dark rounded overflow-hidden">
          <div
            className="h-full bg-amber-base"
            style={{ width: `${Math.min(100, (lock.currentCount / Math.max(1, lock.unlocksAt)) * 100)}%` }}
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
