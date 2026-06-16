import { describe, expect, it } from "vitest";
import {
  DEFAULT_EFFICACY_WEIGHTS,
  DEFAULT_FRESHNESS_THRESHOLD_SECONDS,
  DEFAULT_SOURCE_DIVERSITY_TARGET,
  efficacyConfig,
  type EfficacyDriverKey,
} from "./config";
import {
  computeEfficacyIndex,
  coverageFromFeeds,
  freshnessDecay,
  normalizeHost,
  normalizeWeights,
  rollupEfficacy,
  sourceDiversity,
  survivalRate,
  verificationRate,
  type DriverMeasurement,
} from "./efficacyMath";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

function measurements(
  values: Partial<Record<EfficacyDriverKey, number | null>>,
  withAction = true,
): Record<EfficacyDriverKey, DriverMeasurement> {
  const keys: EfficacyDriverKey[] = [
    "coverage",
    "freshness",
    "verificationRate",
    "adversarialSurvival",
    "sourceDiversity",
  ];
  const out = {} as Record<EfficacyDriverKey, DriverMeasurement>;
  for (const k of keys) {
    const v = k in values ? (values[k] as number | null) : 0;
    out[k] = { value: v, reason: "test", actionPhrase: withAction ? "Connect " + k : null };
  }
  return out;
}

describe("normalizeWeights", () => {
  it("leaves a unit-sum set unchanged and renormalizes a scaled set", () => {
    const w = normalizeWeights(DEFAULT_EFFICACY_WEIGHTS);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(w.coverage).toBeCloseTo(0.25, 10);

    const scaled = normalizeWeights({
      coverage: 2.5,
      freshness: 1.5,
      verificationRate: 2.5,
      adversarialSurvival: 1.5,
      sourceDiversity: 2,
    });
    expect(scaled.coverage).toBeCloseTo(0.25, 10);
    expect(Object.values(scaled).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("falls back to equal weights when all are zero", () => {
    const w = normalizeWeights({
      coverage: 0,
      freshness: 0,
      verificationRate: 0,
      adversarialSurvival: 0,
      sourceDiversity: 0,
    });
    expect(w.coverage).toBeCloseTo(0.2, 10);
  });
});

describe("freshnessDecay", () => {
  it("is a half-life decay clamped to zero past the max multiple", () => {
    expect(freshnessDecay(0, DAY, 4)).toBe(1);
    expect(freshnessDecay(DAY, DAY, 4)).toBe(0.5);
    expect(freshnessDecay(2 * DAY, DAY, 4)).toBe(0.25);
    expect(freshnessDecay(4 * DAY, DAY, 4)).toBe(0);
    expect(freshnessDecay(10 * DAY, DAY, 4)).toBe(0);
  });

  it("guards bad inputs", () => {
    expect(freshnessDecay(-1, DAY, 4)).toBe(0);
    expect(freshnessDecay(DAY, 0, 4)).toBe(0);
  });
});

describe("coverageFromFeeds", () => {
  const alias = {
    GA4: ["marketing-web-analytics"],
    "Ad platforms": ["marketing-web-analytics"],
    News: [],
  };

  it("counts only mappable feeds and lists the missing ones", () => {
    const present = new Set(["marketing-web-analytics"]);
    const r = coverageFromFeeds(["GA4", "Ad platforms", "News"], present, alias);
    expect(r).toEqual({ value: 1, covered: 2, mappable: 2, missingFeeds: [] });
  });

  it("reports zero coverage with the missing feeds when nothing is present", () => {
    const r = coverageFromFeeds(["GA4", "Ad platforms", "News"], new Set(), alias);
    expect(r.value).toBe(0);
    expect(r.missingFeeds).toEqual(["GA4", "Ad platforms"]);
  });

  it("is not measurable when no feed maps to a connector family", () => {
    const r = coverageFromFeeds(["News"], new Set(["marketing-web-analytics"]), alias);
    expect(r.value).toBeNull();
    expect(r.mappable).toBe(0);
  });
});

describe("normalizeHost", () => {
  it("strips www and lowercases, and rejects non-urls", () => {
    expect(normalizeHost("https://www.Example.com/path")).toBe("example.com");
    expect(normalizeHost("https://sub.example.com")).toBe("sub.example.com");
    expect(normalizeHost("not a url")).toBeNull();
  });
});

describe("sourceDiversity", () => {
  it("counts distinct hosts plus extra sources against the target", () => {
    const r = sourceDiversity(
      ["https://www.a.com/x", "https://a.com/y", "https://b.com"],
      ["warehouse-bi"],
      5,
    );
    expect(r.distinct).toBe(3);
    expect(r.value).toBeCloseTo(0.6, 10);
  });

  it("caps at one and is null with no sources", () => {
    const many = sourceDiversity(
      ["https://a.com", "https://b.com", "https://c.com", "https://d.com", "https://e.com", "https://f.com"],
      [],
      5,
    );
    expect(many.value).toBe(1);
    expect(sourceDiversity([], [], 5).value).toBeNull();
  });
});

describe("verificationRate and survivalRate", () => {
  it("computes ratios and returns null on an empty denominator", () => {
    expect(verificationRate(3, 1)).toBe(0.75);
    expect(verificationRate(0, 0)).toBeNull();
    expect(survivalRate(2, 4)).toBe(0.5);
    expect(survivalRate(0, 0)).toBeNull();
  });
});

describe("computeEfficacyIndex", () => {
  it("scores a fully connected, fully measured layer at 100 with no improvement", () => {
    const idx = computeEfficacyIndex({
      measurements: measurements({
        coverage: 1,
        freshness: 1,
        verificationRate: 1,
        adversarialSurvival: 1,
        sourceDiversity: 1,
      }),
      weights: DEFAULT_EFFICACY_WEIGHTS,
      dataMode: "connected",
    });
    expect(idx.score).toBe(100);
    expect(idx.modeCeiling).toBe(100);
    expect(idx.unknownWeight).toBe(0);
    expect(idx.cheapestImprovement).toBeNull();
  });

  it("computes a hand-worked mixed score and picks the largest-lift driver", () => {
    const idx = computeEfficacyIndex({
      measurements: measurements({
        coverage: 0.5,
        freshness: 0.5,
        verificationRate: 0.8,
        adversarialSurvival: 0.5,
        sourceDiversity: 0.4,
      }),
      weights: DEFAULT_EFFICACY_WEIGHTS,
      dataMode: "connected",
    });
    // 0.25*0.5 + 0.15*0.5 + 0.25*0.8 + 0.15*0.5 + 0.20*0.4 = 0.555 -> 56
    expect(idx.score).toBe(56);
    expect(idx.cheapestImprovement?.driver).toBe("coverage");
    expect(idx.cheapestImprovement?.liftPoints).toBe(13);
    expect(idx.cheapestImprovement?.hint).toContain("about 13 points");
  });

  it("caps the outside-in ceiling and keeps connector drivers as honest zeros", () => {
    const idx = computeEfficacyIndex({
      measurements: measurements({
        coverage: 0,
        freshness: 0,
        verificationRate: 0.6,
        adversarialSurvival: null,
        sourceDiversity: 0.4,
      }),
      weights: DEFAULT_EFFICACY_WEIGHTS,
      dataMode: "outside_in",
      modeCappedDrivers: ["coverage", "freshness"],
    });
    // 0.25*0 + 0.15*0 + 0.25*0.6 + 0.15*(null->0) + 0.20*0.4 = 0.23 -> 23
    expect(idx.score).toBe(23);
    expect(idx.modeCeiling).toBe(60);
    expect(idx.unknownWeight).toBeCloseTo(0.15, 10);
    const adversarial = idx.drivers.find((d) => d.key === "adversarialSurvival");
    expect(adversarial?.status).toBe("not_measured");
    expect(adversarial?.value).toBeNull();
    // Connecting data is the biggest lever in outside-in mode.
    expect(idx.cheapestImprovement?.driver).toBe("coverage");
    expect(idx.cheapestImprovement?.liftPoints).toBe(25);
  });

  it("never lets a mode-capped driver lift the score above the ceiling", () => {
    // Defence in depth: even if fully measured, signal-like values are handed in
    // for the capped connector-grounded drivers (for example a derived signal
    // left over from a prior connected run), an outside-in index must not exceed
    // modeCeiling, and the capped drivers must show a zero contribution.
    const idx = computeEfficacyIndex({
      measurements: measurements({
        coverage: 1,
        freshness: 1,
        verificationRate: 1,
        adversarialSurvival: 1,
        sourceDiversity: 1,
      }),
      weights: DEFAULT_EFFICACY_WEIGHTS,
      dataMode: "outside_in",
      modeCappedDrivers: ["coverage", "freshness"],
    });
    expect(idx.modeCeiling).toBe(60);
    expect(idx.score).toBe(60);
    expect(idx.score).toBeLessThanOrEqual(idx.modeCeiling);
    expect(idx.drivers.find((d) => d.key === "coverage")?.contributionPoints).toBe(0);
    expect(idx.drivers.find((d) => d.key === "freshness")?.contributionPoints).toBe(0);
  });

  it("treats unmeasured drivers as unknown weight, not zero contribution dressed as measured", () => {
    const idx = computeEfficacyIndex({
      measurements: measurements({
        coverage: null,
        freshness: null,
        verificationRate: 1,
        adversarialSurvival: null,
        sourceDiversity: null,
      }),
      weights: DEFAULT_EFFICACY_WEIGHTS,
      dataMode: "connected",
    });
    expect(idx.score).toBe(25);
    expect(idx.unknownWeight).toBeCloseTo(0.75, 10);
    const coverage = idx.drivers.find((d) => d.key === "coverage");
    expect(coverage?.status).toBe("not_measured");
  });
});

describe("rollupEfficacy", () => {
  it("means the layer scores and is null when empty", () => {
    expect(rollupEfficacy([60, 80, 40])).toEqual({ score: 60, n: 3 });
    expect(rollupEfficacy([])).toEqual({ score: null, n: 0 });
  });
});

describe("efficacyConfig", () => {
  it("reads the driver weights and thresholds from the environment", () => {
    const cfg = efficacyConfig({
      EFFICACY_WEIGHT_COVERAGE: "0.4",
      EFFICACY_WEIGHT_FRESHNESS: "0.1",
      EFFICACY_WEIGHT_VERIFICATION: "0.2",
      EFFICACY_WEIGHT_ADVERSARIAL: "0.1",
      EFFICACY_WEIGHT_DIVERSITY: "0.2",
      EFFICACY_FRESHNESS_THRESHOLD_SECONDS: "3600",
      EFFICACY_FRESHNESS_MAX_MULTIPLE: "6",
      EFFICACY_SOURCE_DIVERSITY_TARGET: "8",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.weights.coverage).toBe(0.4);
    expect(cfg.weights.freshness).toBe(0.1);
    expect(cfg.weights.verificationRate).toBe(0.2);
    expect(cfg.weights.adversarialSurvival).toBe(0.1);
    expect(cfg.weights.sourceDiversity).toBe(0.2);
    expect(cfg.freshnessThresholdSeconds).toBe(3600);
    expect(cfg.freshnessMaxMultiple).toBe(6);
    expect(cfg.sourceDiversityTarget).toBe(8);
  });

  it("ignores malformed or non-positive overrides and keeps the documented defaults", () => {
    const cfg = efficacyConfig({
      EFFICACY_WEIGHT_COVERAGE: "not-a-number",
      EFFICACY_FRESHNESS_THRESHOLD_SECONDS: "-10",
      EFFICACY_SOURCE_DIVERSITY_TARGET: "0",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.weights.coverage).toBe(DEFAULT_EFFICACY_WEIGHTS.coverage);
    expect(cfg.freshnessThresholdSeconds).toBe(DEFAULT_FRESHNESS_THRESHOLD_SECONDS);
    expect(cfg.sourceDiversityTarget).toBe(DEFAULT_SOURCE_DIVERSITY_TARGET);
  });
});
