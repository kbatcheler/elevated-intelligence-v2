import { describe, expect, it } from "vitest";
import {
  applyNoise,
  computeQuartiles,
  normalizeSegmentPart,
  percentile,
  segmentKeyFor,
} from "./benchmarkMath";

describe("normalizeSegmentPart", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeSegmentPart("  Series B  ")).toBe("series b");
    expect(normalizeSegmentPart("SaaS")).toBe("saas");
    expect(normalizeSegmentPart("Health\t  Care")).toBe("health care");
  });
});

describe("segmentKeyFor", () => {
  it("joins the normalized sector and revenue band with a pipe", () => {
    const seg = segmentKeyFor(" SaaS ", "Series  B");
    expect(seg).toEqual({ segmentKey: "saas|series b", sector: "saas", revenueBand: "series b" });
  });

  it("returns null when either part is empty after normalization", () => {
    expect(segmentKeyFor("", "series b")).toBeNull();
    expect(segmentKeyFor("saas", "   ")).toBeNull();
    expect(segmentKeyFor(null, undefined)).toBeNull();
  });
});

describe("percentile", () => {
  it("interpolates linearly between closest ranks", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0.25)).toBe(20);
    expect(percentile(sorted, 0.5)).toBe(30);
    expect(percentile(sorted, 0.75)).toBe(40);
  });

  it("handles a single value and a non-aligned rank", () => {
    expect(percentile([42], 0.25)).toBe(42);
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10);
    expect(percentile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 10);
  });

  it("throws on an empty set rather than inventing a value", () => {
    expect(() => percentile([], 0.5)).toThrow();
  });
});

describe("computeQuartiles", () => {
  it("computes p25 <= p50 <= p75 from an unsorted input without mutating it", () => {
    const input = [50, 10, 40, 20, 30];
    const q = computeQuartiles(input);
    expect(q).toEqual({ p25: 20, p50: 30, p75: 40 });
    expect(input).toEqual([50, 10, 40, 20, 30]);
    expect(q.p25).toBeLessThanOrEqual(q.p50);
    expect(q.p50).toBeLessThanOrEqual(q.p75);
  });
});

describe("applyNoise", () => {
  const q = { p25: 20, p50: 30, p75: 40 }; // IQR 20, fraction 0.1 -> bound 2

  it("bounds every percentile within +/- (fraction * IQR) of its original", () => {
    const high = applyNoise(q, () => 1, 0.1); // jitter +2 each
    const low = applyNoise(q, () => 0, 0.1); // jitter -2 each
    for (const r of [high, low]) {
      expect(r.p25).toBeGreaterThanOrEqual(18);
      expect(r.p25).toBeLessThanOrEqual(22);
      expect(r.p50).toBeGreaterThanOrEqual(28);
      expect(r.p50).toBeLessThanOrEqual(42);
      expect(r.p75).toBeGreaterThanOrEqual(38);
      expect(r.p75).toBeLessThanOrEqual(42);
    }
  });

  it("always preserves p25 <= p50 <= p75 even under adversarial jitter", () => {
    const seq = [1, 0, 1, 0, 1, 0];
    let i = 0;
    const rng = (): number => seq[i++ % seq.length]!;
    for (let n = 0; n < 6; n += 1) {
      const r = applyNoise(q, rng, 0.5);
      expect(r.p25).toBeLessThanOrEqual(r.p50);
      expect(r.p50).toBeLessThanOrEqual(r.p75);
    }
  });

  it("leaves a degenerate (zero-IQR) cohort unchanged", () => {
    const flat = { p25: 5, p50: 5, p75: 5 };
    expect(applyNoise(flat, () => 0.9, 0.1)).toEqual(flat);
  });
});
