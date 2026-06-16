// Phase AK Data Efficacy Index math. Pure functions, no database and no I/O, so
// every figure on an efficacy surface is a deterministic computation over the
// five named drivers that a hand-worked unit test can pin down. The index is a
// 0-to-100 weighted average; a null driver is "not measured", contributes zero,
// and is disclosed (never quietly renormalized away, because hiding missing
// evidence would flatter the score).

import {
  EFFICACY_DRIVER_KEYS,
  EFFICACY_DRIVER_LABELS,
  type EfficacyDriverKey,
} from "./config";

export type DataMode = "outside_in" | "connected";
export type DriverStatus = "measured" | "not_measured";

// One driver's raw measurement as the service computes it. value is in [0,1]
// when measured and null when there is genuinely nothing to measure yet.
// actionPhrase is the imperative the cheapest-improvement hint uses ("Connect
// receivables data"); null means there is no known lever for this driver.
export interface DriverMeasurement {
  value: number | null;
  reason: string;
  actionPhrase: string | null;
}

export interface DriverResult {
  key: EfficacyDriverKey;
  label: string;
  value: number | null;
  status: DriverStatus;
  weight: number;
  contributionPoints: number;
  reason: string;
}

export interface CheapestImprovement {
  driver: EfficacyDriverKey;
  label: string;
  liftPoints: number;
  hint: string;
}

export interface EfficacyIndex {
  score: number;
  drivers: DriverResult[];
  // The share of the index weight whose driver is not measured, so the UI can
  // say "n percent of this score is not yet measured" rather than implying the
  // unmeasured drivers are zeros.
  unknownWeight: number;
  // The highest index achievable in the current data mode. Connected can reach
  // 100; outside-in cannot, because its connector-grounded drivers (coverage,
  // freshness) are structurally zero, which is the honest demo-to-pilot number.
  modeCeiling: number;
  dataMode: DataMode;
  cheapestImprovement: CheapestImprovement | null;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Renormalize raw driver weights to sum to 1. An all-zero or invalid set falls
// back to equal weights so the index is always a proper weighted average.
export function normalizeWeights(
  weights: Record<EfficacyDriverKey, number>,
): Record<EfficacyDriverKey, number> {
  const cleaned = EFFICACY_DRIVER_KEYS.map(
    (k) => [k, Number.isFinite(weights[k]) ? Math.max(0, weights[k]) : 0] as const,
  );
  const sum = cleaned.reduce((acc, [, v]) => acc + v, 0);
  const out = {} as Record<EfficacyDriverKey, number>;
  if (sum <= 0) {
    const equal = 1 / EFFICACY_DRIVER_KEYS.length;
    for (const k of EFFICACY_DRIVER_KEYS) out[k] = equal;
    return out;
  }
  for (const [k, v] of cleaned) out[k] = v / sum;
  return out;
}

// Freshness as a half-life decay against a cadence threshold: age 0 reads 1.0,
// one threshold reads 0.5, two thresholds 0.25, and anything at or past the max
// multiple reads exactly 0 rather than an ever-smaller positive tail.
export function freshnessDecay(
  ageSeconds: number,
  thresholdSeconds: number,
  maxMultiple: number,
): number {
  if (!(thresholdSeconds > 0) || !(ageSeconds >= 0)) return 0;
  if (ageSeconds >= maxMultiple * thresholdSeconds) return 0;
  return round(2 ** (-ageSeconds / thresholdSeconds), 4);
}

// Coverage: of the layer's registry feeds that CAN be sourced from a connector
// (a feed mapped to at least one connector family), the share that actually has
// a derived signal present. Feeds with no connector family are not measurable
// and are excluded from the denominator rather than scored as permanent misses.
// Returns null when no feed is measurable from connectors.
export function coverageFromFeeds(
  feeds: string[],
  presentFamilies: Set<string>,
  aliasMap: Record<string, string[]>,
): { value: number | null; covered: number; mappable: number; missingFeeds: string[] } {
  let mappable = 0;
  let covered = 0;
  const missingFeeds: string[] = [];
  for (const feed of feeds) {
    const families = aliasMap[feed];
    if (!families || families.length === 0) continue;
    mappable += 1;
    const isCovered = families.some((f) => presentFamilies.has(f));
    if (isCovered) covered += 1;
    else missingFeeds.push(feed);
  }
  if (mappable === 0) return { value: null, covered: 0, mappable: 0, missingFeeds: [] };
  return { value: round(covered / mappable, 4), covered, mappable, missingFeeds };
}

// Normalize a source URL to a bare hostname (lowercased, leading "www." removed)
// using the Node URL parser, no network call. Returns null for anything that is
// not a parseable URL so a malformed reference never inflates diversity.
export function normalizeHost(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

// Source diversity: the count of distinct independent sources behind the
// diagnosis (distinct claim and confounder source hostnames, plus distinct
// connector sources in connected mode), scaled against a target. Returns null
// when no source is present at all.
export function sourceDiversity(
  urls: string[],
  extraSources: string[],
  target: number,
): { value: number | null; distinct: number } {
  const set = new Set<string>();
  for (const u of urls) {
    const host = normalizeHost(u);
    if (host) set.add("host:" + host);
  }
  for (const e of extraSources) {
    if (e) set.add("src:" + e);
  }
  if (set.size === 0) return { value: null, distinct: 0 };
  const t = target > 0 ? target : 1;
  return { value: round(clamp(set.size / t, 0, 1), 4), distinct: set.size };
}

// Verification rate: verified claims over verified-plus-modelled. Null when the
// layer has no claims of either kind yet.
export function verificationRate(verified: number, modelled: number): number | null {
  const total = verified + modelled;
  if (total <= 0) return null;
  return round(verified / total, 4);
}

// Adversarial survival: confounders ruled out over all confounder verdicts.
// Null when the Confounder stage produced no verdicts (for example a reduced
// express build that skipped it).
export function survivalRate(ruledOut: number, total: number): number | null {
  if (total <= 0) return null;
  return round(ruledOut / total, 4);
}

// The whole index from the five measured drivers. Mode-capped drivers are the
// ones structurally unreachable in the current data mode (coverage and freshness
// for outside-in); they lower modeCeiling but are still shown so the gap is
// visible. score is rounded to a whole number; contributions keep one decimal.
export function computeEfficacyIndex(args: {
  measurements: Record<EfficacyDriverKey, DriverMeasurement>;
  weights: Record<EfficacyDriverKey, number>;
  dataMode: DataMode;
  modeCappedDrivers?: EfficacyDriverKey[];
}): EfficacyIndex {
  const w = normalizeWeights(args.weights);
  const capped = new Set(args.modeCappedDrivers ?? []);
  const drivers: DriverResult[] = [];
  let scoreFraction = 0;
  let unknownWeight = 0;

  for (const key of EFFICACY_DRIVER_KEYS) {
    const m = args.measurements[key];
    const measured = m.value !== null && Number.isFinite(m.value);
    const value = measured ? clamp(m.value as number, 0, 1) : null;
    const weight = w[key];
    // A mode-capped driver is structurally unreachable in this data mode, so it
    // can never add to the score. Forcing its contribution to zero guarantees
    // the index can never exceed modeCeiling, even if a stray measurement (for
    // example a derived signal left over from a prior connected run) is handed
    // in for it. The driver is still shown, at a visible zero contribution.
    const contribution = capped.has(key) ? 0 : weight * (value ?? 0);
    scoreFraction += contribution;
    if (!measured) unknownWeight += weight;
    drivers.push({
      key,
      label: EFFICACY_DRIVER_LABELS[key],
      value: value === null ? null : round(value, 4),
      status: measured ? "measured" : "not_measured",
      weight: round(weight, 4),
      contributionPoints: round(contribution * 100, 1),
      reason: m.reason,
    });
  }

  let cappedWeight = 0;
  for (const k of capped) cappedWeight += w[k];

  let best: CheapestImprovement | null = null;
  for (const key of EFFICACY_DRIVER_KEYS) {
    const m = args.measurements[key];
    if (!m.actionPhrase) continue;
    const value = m.value !== null && Number.isFinite(m.value) ? clamp(m.value as number, 0, 1) : 0;
    if (value >= 1) continue;
    const liftPoints = Math.round(w[key] * (1 - value) * 100);
    if (liftPoints <= 0) continue;
    if (!best || liftPoints > best.liftPoints) {
      best = {
        driver: key,
        label: EFFICACY_DRIVER_LABELS[key],
        liftPoints,
        hint: m.actionPhrase + " to lift efficacy about " + liftPoints + " points",
      };
    }
  }

  return {
    score: Math.round(scoreFraction * 100),
    drivers,
    unknownWeight: round(unknownWeight, 4),
    modeCeiling: Math.round((1 - cappedWeight) * 100),
    dataMode: args.dataMode,
    cheapestImprovement: best,
  };
}

// Tenant and portfolio rollups are the simple mean of the per-layer scores, or
// null when there are no scored layers (never a fabricated zero).
export function rollupEfficacy(scores: number[]): { score: number | null; n: number } {
  if (scores.length === 0) return { score: null, n: 0 };
  const sum = scores.reduce((acc, s) => acc + s, 0);
  return { score: Math.round(sum / scores.length), n: scores.length };
}
