import { describe, expect, it } from "vitest";
import {
  computeRankScore,
  evaluateSuppression,
  formatUsd,
  highValueDedupeKey,
  rankCandidates,
  round4,
  shortfallDedupeKey,
  type PushThresholds,
} from "./pushMath";

const NOW = Date.UTC(2026, 5, 15, 9, 0, 0);

function thresholds(partial: Partial<PushThresholds> = {}): PushThresholds {
  return {
    enabled: true,
    mutedUntil: null,
    minImpactUsd: null,
    minConfidence: null,
    ...partial,
  };
}

describe("computeRankScore", () => {
  it("is impact scaled by the confidence fraction, rounded to four decimals", () => {
    expect(computeRankScore(100000, 80)).toBe(80000);
    expect(computeRankScore(12345.67, 33)).toBe(round4(12345.67 * 0.33));
  });

  it("is zero when there is no dollar figure or no confidence, so it ranks last", () => {
    expect(computeRankScore(null, 80)).toBe(0);
    expect(computeRankScore(100000, null)).toBe(0);
    expect(computeRankScore(null, null)).toBe(0);
  });

  it("is zero for a non-finite input rather than NaN, never a fabricated rank", () => {
    expect(computeRankScore(Number.POSITIVE_INFINITY, 80)).toBe(0);
    expect(computeRankScore(100000, Number.NaN)).toBe(0);
  });
});

describe("evaluateSuppression", () => {
  it("passes a quantified breach with no floors configured", () => {
    expect(
      evaluateSuppression({ impactUsd: 5000, confidence: 70, thresholds: thresholds(), now: NOW }),
    ).toEqual({ suppressed: false, reason: null });
  });

  it("suppresses when the rule is disabled", () => {
    expect(
      evaluateSuppression({
        impactUsd: 5000,
        confidence: 70,
        thresholds: thresholds({ enabled: false }),
        now: NOW,
      }),
    ).toEqual({ suppressed: true, reason: "disabled" });
  });

  it("suppresses while muted into the future, and resumes once the mute has passed", () => {
    expect(
      evaluateSuppression({
        impactUsd: 5000,
        confidence: 70,
        thresholds: thresholds({ mutedUntil: NOW + 60_000 }),
        now: NOW,
      }),
    ).toEqual({ suppressed: true, reason: "muted" });
    expect(
      evaluateSuppression({
        impactUsd: 5000,
        confidence: 70,
        thresholds: thresholds({ mutedUntil: NOW - 60_000 }),
        now: NOW,
      }),
    ).toEqual({ suppressed: false, reason: null });
  });

  it("suppresses an unquantified candidate before any threshold check", () => {
    expect(
      evaluateSuppression({
        impactUsd: null,
        confidence: 70,
        thresholds: thresholds({ minImpactUsd: 0 }),
        now: NOW,
      }),
    ).toEqual({ suppressed: true, reason: "no_dollar" });
  });

  it("suppresses below the impact floor and below the confidence floor", () => {
    expect(
      evaluateSuppression({
        impactUsd: 999,
        confidence: 70,
        thresholds: thresholds({ minImpactUsd: 1000 }),
        now: NOW,
      }),
    ).toEqual({ suppressed: true, reason: "below_impact" });
    expect(
      evaluateSuppression({
        impactUsd: 5000,
        confidence: 40,
        thresholds: thresholds({ minConfidence: 50 }),
        now: NOW,
      }),
    ).toEqual({ suppressed: true, reason: "below_confidence" });
  });

  it("passes exactly at the floor, suppressing only strictly below it", () => {
    expect(
      evaluateSuppression({
        impactUsd: 1000,
        confidence: 50,
        thresholds: thresholds({ minImpactUsd: 1000, minConfidence: 50 }),
        now: NOW,
      }),
    ).toEqual({ suppressed: false, reason: null });
  });
});

describe("rankCandidates", () => {
  it("orders by rank score, then dollar impact, then a stable id tiebreak", () => {
    const ranked = rankCandidates([
      { rankScore: 100, impactUsd: 200, sourceId: "b" },
      { rankScore: 100, impactUsd: 200, sourceId: "a" },
      { rankScore: 500, impactUsd: 600, sourceId: "c" },
      { rankScore: 100, impactUsd: 900, sourceId: "d" },
    ]);
    expect(ranked.map((r) => r.sourceId)).toEqual(["c", "d", "a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [
      { rankScore: 1, impactUsd: 1, sourceId: "a" },
      { rankScore: 2, impactUsd: 2, sourceId: "b" },
    ];
    const before = input.map((r) => r.sourceId);
    rankCandidates(input);
    expect(input.map((r) => r.sourceId)).toEqual(before);
  });
});

describe("dedupe keys", () => {
  it("anchor a shortfall to its measurement and a high-value event to its action", () => {
    expect(shortfallDedupeKey("m1")).toBe("outcome_shortfall:m1");
    expect(highValueDedupeKey("a1")).toBe("high_value_action:a1");
  });
});

describe("formatUsd", () => {
  it("groups thousands with ASCII commas and rounds to whole dollars", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(999)).toBe("$999");
    expect(formatUsd(1000)).toBe("$1,000");
    expect(formatUsd(60000)).toBe("$60,000");
    expect(formatUsd(1234567.89)).toBe("$1,234,568");
  });

  it("renders a negative with a leading ASCII hyphen and never a non-finite value", () => {
    expect(formatUsd(-2500)).toBe("-$2,500");
    expect(formatUsd(Number.NaN)).toBe("$0");
  });
});
