// Phase AJ Brier-score math. Pure functions, no database and no I/O, so every
// figure on the calibration surface is a deterministic computation over resolved
// forecasts that a hand-worked unit test can pin down. The Brier score is the
// mean squared error of a probabilistic forecast: 0 is perfect, 1 is perfectly
// wrong, and an always-0.5 (coin-flip) forecaster scores exactly 0.25. A real
// forecasting system beats 0.25; a number above it is the honest signal that the
// system's probabilities are no better than chance.

import {
  CALIBRATION_BAND_SIZE,
  CONFIDENCE_NEUTRAL_FLOOR,
  MAX_CONFIDENCE_PENALTY,
} from "./config";

// The score of the trivial always-0.5 forecaster: (0.5 - o)^2 = 0.25 for either
// outcome. The fixed reference line every aggregate is read against.
export const NAIVE_BASELINE = 0.25;

export function naiveBaseline(): number {
  return NAIVE_BASELINE;
}

// A resolved forecast reduced to the fields the math needs. probability is the
// stated likelihood in [0,1]; outcome is the realised 0 or 1. The grouping keys
// carry the segment labels so one pass can produce every breakdown.
export interface ResolvedForecastPoint {
  probability: number;
  outcome: 0 | 1;
  layerKey: string;
  kind: string;
  subjectSeat: string;
}

export interface BrierAggregate {
  meanBrier: number | null;
  n: number;
}

export interface BrierSegment extends BrierAggregate {
  key: string;
}

export interface CalibrationBand {
  lower: number;
  upper: number;
  n: number;
  // The mean stated probability of the forecasts in this band, and the observed
  // frequency with which they came true. Null when the band is empty: an empty
  // band has no point to plot, never a fabricated zero.
  avgProbability: number | null;
  observedFrequency: number | null;
}

export interface SampleLabel {
  established: boolean;
  // A short, honest label: "established" once the sample clears the threshold,
  // otherwise "early, n resolved" so a thin sample never reads as a track record.
  label: string;
}

export interface ConfidenceCalibration {
  raw: number;
  adjusted: number;
  applied: boolean;
  // Why the adjustment was or was not applied, so the portal can be honest about
  // it rather than silently moving a number.
  reason: "insufficient_sample" | "well_calibrated" | "overconfident_penalty";
  penalty: number;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// The per-forecast Brier score, (probability - outcome)^2, rounded to six
// places so persisted scores and recomputed scores compare exactly.
export function brierScore(probability: number, outcome: 0 | 1): number {
  const p = clamp(probability, 0, 1);
  return round((p - outcome) ** 2, 6);
}

// The mean Brier over a set of points, or null for an empty set (no figure is
// shown for no data). Computed from probability and outcome directly so the
// aggregate never depends on a separately persisted per-row score.
export function aggregateBrier(points: ResolvedForecastPoint[]): BrierAggregate {
  if (points.length === 0) return { meanBrier: null, n: 0 };
  const sum = points.reduce((acc, p) => acc + (clamp(p.probability, 0, 1) - p.outcome) ** 2, 0);
  return { meanBrier: round(sum / points.length, 6), n: points.length };
}

// Group the points by a segment key and aggregate each group, sorted worst Brier
// first (the segments most in need of attention lead). Empty input yields an
// empty list.
export function aggregateBy(
  points: ResolvedForecastPoint[],
  keyFn: (p: ResolvedForecastPoint) => string,
): BrierSegment[] {
  const groups = new Map<string, ResolvedForecastPoint[]>();
  for (const p of points) {
    const k = keyFn(p);
    const bucket = groups.get(k);
    if (bucket) bucket.push(p);
    else groups.set(k, [p]);
  }
  const segments: BrierSegment[] = [];
  for (const [key, group] of groups) {
    const agg = aggregateBrier(group);
    segments.push({ key, meanBrier: agg.meanBrier, n: agg.n });
  }
  segments.sort((a, b) => (b.meanBrier ?? 0) - (a.meanBrier ?? 0));
  return segments;
}

// The reliability (calibration) curve: stated-probability bands compared against
// the observed frequency. A well-calibrated system tracks the diagonal (forecasts
// it calls 70 percent come true about 70 percent of the time). Every band is
// returned so the curve's x-axis is complete; empty bands carry null statistics
// rather than a fabricated point.
export function calibrationCurve(
  points: ResolvedForecastPoint[],
  opts?: { bandSize?: number },
): CalibrationBand[] {
  const bandSize = opts?.bandSize ?? CALIBRATION_BAND_SIZE;
  const bandCount = Math.round(1 / bandSize);
  const buckets: ResolvedForecastPoint[][] = Array.from({ length: bandCount }, () => []);
  for (const p of points) {
    const prob = clamp(p.probability, 0, 1);
    // p == 1 lands in the top band rather than spilling into a non-existent one.
    const idx = Math.min(bandCount - 1, Math.floor(prob / bandSize));
    buckets[idx].push(p);
  }
  return buckets.map((bucket, i) => {
    const lower = round(i * bandSize, 4);
    const upper = round((i + 1) * bandSize, 4);
    if (bucket.length === 0) {
      return { lower, upper, n: 0, avgProbability: null, observedFrequency: null };
    }
    const probSum = bucket.reduce((acc, p) => acc + clamp(p.probability, 0, 1), 0);
    const hitSum = bucket.reduce((acc, p) => acc + p.outcome, 0);
    return {
      lower,
      upper,
      n: bucket.length,
      avgProbability: round(probSum / bucket.length, 4),
      observedFrequency: round(hitSum / bucket.length, 4),
    };
  });
}

// The honest sample-size label. A segment is only "established" once its resolved
// count clears the threshold; below it the count is surfaced so a thin sample is
// never dressed up as a proven track record.
export function labelSample(n: number, threshold: number): SampleLabel {
  if (n >= threshold) return { established: true, label: "established" };
  return { established: false, label: "early, " + n + " resolved" };
}

// Display-only confidence calibration. The Evaluator's raw confidence is never
// overwritten; this returns an adjusted value for display that disciplines an
// overconfident layer with a poor Brier track record. The adjustment is:
//   - gated: nothing happens until the layer has threshold-many resolved
//     forecasts, so a thin or absent record leaves the pill untouched;
//   - downward only: a layer at or better than the 0.25 baseline is left alone,
//     never inflated;
//   - bounded: at most MAX_CONFIDENCE_PENALTY points, scaled by how far past the
//     baseline the Brier sits, and never pulled below the neutral floor or below
//     a raw confidence that already sits under it.
export function applyConfidenceCalibration(
  raw: number,
  segment: { brier: number | null; n: number; threshold: number },
): ConfidenceCalibration {
  const { brier, n, threshold } = segment;
  if (brier === null || n < threshold) {
    return { raw, adjusted: raw, applied: false, reason: "insufficient_sample", penalty: 0 };
  }
  if (brier <= NAIVE_BASELINE) {
    return { raw, adjusted: raw, applied: false, reason: "well_calibrated", penalty: 0 };
  }
  // How far past the baseline the Brier sits, as a fraction of the worst-case
  // remaining range (0.25 to 1.0), clamped to [0,1].
  const severity = clamp((brier - NAIVE_BASELINE) / (1 - NAIVE_BASELINE), 0, 1);
  const penalty = round(severity * MAX_CONFIDENCE_PENALTY, 2);
  // Pull toward the neutral floor, but never above raw (no inflation) and never
  // below the floor.
  const pulled = Math.max(CONFIDENCE_NEUTRAL_FLOOR, raw - penalty);
  const adjusted = round(Math.min(raw, pulled), 2);
  return {
    raw,
    adjusted,
    applied: adjusted < raw,
    reason: "overconfident_penalty",
    penalty: round(raw - adjusted, 2),
  };
}
