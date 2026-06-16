import { describe, expect, it } from "vitest";
import {
  aggregateBrier,
  aggregateBy,
  applyConfidenceCalibration,
  brierScore,
  calibrationCurve,
  labelSample,
  naiveBaseline,
  NAIVE_BASELINE,
  type ResolvedForecastPoint,
} from "./brierMath";

// Pure Brier math, pinned by hand-worked examples. The Brier score is the mean
// squared error of a probabilistic forecast: 0 is perfect, 1 is perfectly wrong,
// and an always-0.5 forecaster scores exactly 0.25. Every figure here is checked
// against a number computed by hand, so a regression in the math is caught
// rather than rationalised.

function pt(probability: number, outcome: 0 | 1, over: Partial<ResolvedForecastPoint> = {}): ResolvedForecastPoint {
  return { probability, outcome, layerKey: "L", kind: "action_outcome", subjectSeat: "Evaluator", ...over };
}

describe("brierScore (hand-worked)", () => {
  it("scores a confident hit well: (0.8 - 1)^2 = 0.04", () => {
    expect(brierScore(0.8, 1)).toBe(0.04);
  });

  it("scores a confident miss badly: (0.8 - 0)^2 = 0.64", () => {
    expect(brierScore(0.8, 0)).toBe(0.64);
  });

  it("scores a coin flip at the 0.25 baseline either way", () => {
    expect(brierScore(0.5, 1)).toBe(0.25);
    expect(brierScore(0.5, 0)).toBe(0.25);
  });

  it("is perfect at the extremes and clamps out-of-range probabilities", () => {
    expect(brierScore(1, 1)).toBe(0);
    expect(brierScore(0, 0)).toBe(0);
    expect(brierScore(1.5, 1)).toBe(0);
    expect(brierScore(-0.5, 0)).toBe(0);
  });
});

describe("naiveBaseline", () => {
  it("is exactly 0.25, the always-0.5 forecaster's score", () => {
    expect(NAIVE_BASELINE).toBe(0.25);
    expect(naiveBaseline()).toBe(0.25);
  });
});

describe("aggregateBrier", () => {
  it("returns null mean and zero n for an empty set, never a fabricated zero", () => {
    expect(aggregateBrier([])).toEqual({ meanBrier: null, n: 0 });
  });

  it("means the per-forecast scores: (0.04 + 0.64) / 2 = 0.34", () => {
    expect(aggregateBrier([pt(0.8, 1), pt(0.8, 0)])).toEqual({ meanBrier: 0.34, n: 2 });
  });

  it("computes from probability and outcome directly, not a stored score", () => {
    expect(aggregateBrier([pt(0.9, 1), pt(0.95, 0)])).toEqual({ meanBrier: 0.45625, n: 2 });
  });
});

describe("aggregateBy", () => {
  it("groups by key and sorts worst Brier first", () => {
    const points = [
      pt(0.9, 1, { layerKey: "good" }),
      pt(0.9, 1, { layerKey: "good" }),
      pt(0.95, 0, { layerKey: "bad" }),
    ];
    const segs = aggregateBy(points, (p) => p.layerKey);
    expect(segs.map((s) => s.key)).toEqual(["bad", "good"]);
    expect(segs[0]).toEqual({ key: "bad", meanBrier: 0.9025, n: 1 });
    expect(segs[1]).toEqual({ key: "good", meanBrier: 0.01, n: 2 });
  });

  it("returns an empty list for no points", () => {
    expect(aggregateBy([], (p) => p.kind)).toEqual([]);
  });
});

describe("calibrationCurve", () => {
  it("returns ten bands by default, empty bands carrying null statistics", () => {
    const curve = calibrationCurve([pt(0.85, 1), pt(0.85, 0)]);
    expect(curve).toHaveLength(10);
    const band = curve[8];
    expect(band.lower).toBe(0.8);
    expect(band.upper).toBe(0.9);
    expect(band.n).toBe(2);
    expect(band.avgProbability).toBe(0.85);
    expect(band.observedFrequency).toBe(0.5);
    const empty = curve[0];
    expect(empty.n).toBe(0);
    expect(empty.avgProbability).toBeNull();
    expect(empty.observedFrequency).toBeNull();
  });

  it("lands probability 1.0 in the top band rather than spilling over", () => {
    const curve = calibrationCurve([pt(1, 1)]);
    expect(curve[9].n).toBe(1);
    expect(curve[9].observedFrequency).toBe(1);
  });
});

describe("labelSample", () => {
  it("is established at or above the threshold", () => {
    expect(labelSample(10, 10)).toEqual({ established: true, label: "established" });
    expect(labelSample(11, 10)).toEqual({ established: true, label: "established" });
  });

  it("is honest about a thin sample below the threshold", () => {
    expect(labelSample(3, 10)).toEqual({ established: false, label: "early, 3 resolved" });
    expect(labelSample(0, 10)).toEqual({ established: false, label: "early, 0 resolved" });
  });
});

describe("applyConfidenceCalibration", () => {
  it("does nothing below the resolved-sample threshold", () => {
    const out = applyConfidenceCalibration(90, { brier: 1, n: 4, threshold: 10 });
    expect(out).toEqual({ raw: 90, adjusted: 90, applied: false, reason: "insufficient_sample", penalty: 0 });
  });

  it("never inflates a well-calibrated layer at or under the baseline", () => {
    const out = applyConfidenceCalibration(90, { brier: 0.2, n: 20, threshold: 10 });
    expect(out).toEqual({ raw: 90, adjusted: 90, applied: false, reason: "well_calibrated", penalty: 0 });
  });

  it("disciplines an overconfident layer downward, scaled by severity", () => {
    // severity = (0.625 - 0.25) / 0.75 = 0.5; penalty = 0.5 * 10 = 5; 90 -> 85.
    const out = applyConfidenceCalibration(90, { brier: 0.625, n: 20, threshold: 10 });
    expect(out.applied).toBe(true);
    expect(out.reason).toBe("overconfident_penalty");
    expect(out.penalty).toBe(5);
    expect(out.adjusted).toBe(85);
  });

  it("caps the penalty at ten points for a perfectly wrong layer", () => {
    const out = applyConfidenceCalibration(95, { brier: 1, n: 20, threshold: 10 });
    expect(out.penalty).toBe(10);
    expect(out.adjusted).toBe(85);
  });

  it("never pulls below the neutral floor of 50", () => {
    const out = applyConfidenceCalibration(52, { brier: 1, n: 20, threshold: 10 });
    expect(out.adjusted).toBe(50);
    expect(out.penalty).toBe(2);
  });

  it("leaves a raw confidence already under the floor untouched, never inflating it", () => {
    const out = applyConfidenceCalibration(40, { brier: 1, n: 20, threshold: 10 });
    expect(out.adjusted).toBe(40);
    expect(out.applied).toBe(false);
  });
});
