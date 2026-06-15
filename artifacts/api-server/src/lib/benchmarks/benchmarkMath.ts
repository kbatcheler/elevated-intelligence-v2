// Phase X benchmark math, kept pure and free of any database handle so the
// percentile, cohort-key, and privacy-noise logic is unit-testable in isolation
// and can never reach a tenant identity: it only ever sees plain numbers and
// already-normalized segment labels.

// The fraction of a cohort's interquartile range used as the bound on privacy
// noise. Small by design: enough to blur a near-threshold cohort's percentiles
// without distorting the distribution it reports.
export const DEFAULT_NOISE_FRACTION = 0.1;

// Normalize one segment label: trim, lowercase, and collapse internal runs of
// whitespace to a single ASCII space. Two tenants that typed "Series B " and
// "series  b" land in the same cohort, and the stored label is the normalized
// form, never any one tenant's raw string.
export function normalizeSegmentPart(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

// The cohort key is the normalized sector and revenue band joined by a pipe.
// Returns null when either part is empty after normalization, so a tenant with
// an unset segment is simply not eligible for any cohort (never grouped under a
// blank key).
export function segmentKeyFor(
  sector: string | null | undefined,
  revenueBand: string | null | undefined,
): { segmentKey: string; sector: string; revenueBand: string } | null {
  const s = normalizeSegmentPart(sector ?? "");
  const r = normalizeSegmentPart(revenueBand ?? "");
  if (s === "" || r === "") return null;
  return { segmentKey: s + "|" + r, sector: s, revenueBand: r };
}

// A percentile by linear interpolation between closest ranks (the inclusive
// method: p in [0,1], rank = p*(n-1)). The input must be sorted ascending and
// non-empty. With one value every percentile is that value.
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) throw new Error("percentile of an empty set is undefined");
  if (n === 1) return sortedAsc[0]!;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sortedAsc[lo]! + frac * (sortedAsc[hi]! - sortedAsc[lo]!);
}

export interface Quartiles {
  p25: number;
  p50: number;
  p75: number;
}

// The 25th, 50th, and 75th percentiles over a set of values. Sorts a copy, so
// the caller's array is left untouched. p25 <= p50 <= p75 always holds for the
// raw quartiles because they read from the same sorted array.
export function computeQuartiles(values: number[]): Quartiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
  };
}

// Apply bounded privacy noise to a quartile triple. The magnitude is tied to the
// cohort's own interquartile range (fraction * IQR), so a tight distribution is
// perturbed little and a wide one more, and it is HARD-capped: each percentile
// is jittered by at most +/- that bound, then the three are re-sorted ascending,
// which guarantees the published triple still satisfies p25 <= p50 <= p75. A
// degenerate cohort (IQR 0) has a zero bound, so its values pass through
// unchanged; the caller still records noised=true because the privacy mechanism
// was engaged for that small cohort. rng returns a value in [0,1).
export function applyNoise(q: Quartiles, rng: () => number, fraction: number): Quartiles {
  const iqr = q.p75 - q.p25;
  const bound = Math.max(0, fraction * iqr);
  const jitter = (): number => (rng() * 2 - 1) * bound;
  const perturbed = [q.p25 + jitter(), q.p50 + jitter(), q.p75 + jitter()].sort(
    (a, b) => a - b,
  );
  return { p25: perturbed[0]!, p50: perturbed[1]!, p75: perturbed[2]! };
}
