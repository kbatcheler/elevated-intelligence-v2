import { describe, expect, it } from "vitest";
import { deriveOverruledStatus, runningRealizedValue } from "./timeline";

// Pure derivations behind the decision audit timeline (Phase AL). Both are
// unit tested without a database: deriveOverruledStatus turns a snapshotted
// decision plus its forecast resolution into the honest overruled verdict, and
// runningRealizedValue accumulates only real graded figures.

describe("deriveOverruledStatus", () => {
  it("returns null when the decision followed the recommendation", () => {
    expect(
      deriveOverruledStatus({
        contradictsRecommendation: false,
        forecastResolved: true,
        forecastOutcome: 1,
      }),
    ).toBeNull();
  });

  it("is pending when an overruling forecast has not resolved", () => {
    expect(
      deriveOverruledStatus({
        contradictsRecommendation: true,
        forecastResolved: false,
        forecastOutcome: null,
      }),
    ).toBe("pending");
  });

  it("is pending when resolved but the outcome is unknown", () => {
    expect(
      deriveOverruledStatus({
        contradictsRecommendation: true,
        forecastResolved: true,
        forecastOutcome: null,
      }),
    ).toBe("pending");
  });

  it("is right when overruled and the recommended action would have failed (outcome 0)", () => {
    expect(
      deriveOverruledStatus({
        contradictsRecommendation: true,
        forecastResolved: true,
        forecastOutcome: 0,
      }),
    ).toBe("right");
  });

  it("is wrong when overruled and the recommended action would have succeeded (outcome 1)", () => {
    expect(
      deriveOverruledStatus({
        contradictsRecommendation: true,
        forecastResolved: true,
        forecastOutcome: 1,
      }),
    ).toBe("wrong");
  });
});

describe("runningRealizedValue", () => {
  it("is empty for no decisions", () => {
    expect(runningRealizedValue([])).toEqual([]);
  });

  it("carries the prior cumulative forward across pending or unmeasured entries", () => {
    expect(
      runningRealizedValue([
        { realizedValueUsd: 1000 },
        { realizedValueUsd: null },
        { realizedValueUsd: 250 },
        { realizedValueUsd: null },
      ]),
    ).toEqual([1000, 1000, 1250, 1250]);
  });

  it("accumulates a negative realised value honestly", () => {
    expect(
      runningRealizedValue([{ realizedValueUsd: 500 }, { realizedValueUsd: -200 }]),
    ).toEqual([500, 300]);
  });

  it("ignores non-finite figures rather than poisoning the total", () => {
    expect(
      runningRealizedValue([
        { realizedValueUsd: 100 },
        { realizedValueUsd: Number.NaN },
        { realizedValueUsd: Number.POSITIVE_INFINITY },
        { realizedValueUsd: 50 },
      ]),
    ).toEqual([100, 100, 100, 150]);
  });

  it("rounds the cumulative to cents, absorbing float drift", () => {
    expect(
      runningRealizedValue([{ realizedValueUsd: 0.1 }, { realizedValueUsd: 0.2 }]),
    ).toEqual([0.1, 0.3]);
  });
});
