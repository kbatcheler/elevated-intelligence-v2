import { describe, expect, it } from "vitest";
import { buildCaseStudies, type CaseStudyContribution } from "./caseStudies";

function contribution(
  overrides: Partial<CaseStudyContribution> = {},
): CaseStudyContribution {
  return {
    segmentKey: "saas|series b",
    sector: "saas",
    revenueBand: "series b",
    realizedUsd: 100_000,
    identifiedUsd: 250_000,
    calibrationHits: 2,
    calibrationMisses: 1,
    ...overrides,
  };
}

describe("buildCaseStudies", () => {
  it("publishes nothing for a segment below the k floor", () => {
    const studies = buildCaseStudies(
      [contribution(), contribution(), contribution()],
      { minCohort: 5, noiseBand: 20 },
    );
    expect(studies).toEqual([]);
  });

  it("publishes a segment at or above k, aggregating outcomes without identity", () => {
    const contributions = Array.from({ length: 6 }, (_v, i) =>
      contribution({ realizedUsd: 100_000 + i * 10_000, identifiedUsd: 200_000 + i * 10_000 }),
    );
    // rng fixed at 0.5 -> jitter is exactly 0, so noised quartiles equal the raw
    // quartiles and the assertion is deterministic.
    const studies = buildCaseStudies(contributions, {
      minCohort: 5,
      noiseBand: 20,
      rng: () => 0.5,
    });
    expect(studies).toHaveLength(1);
    const s = studies[0]!;
    expect(s.contributorCount).toBe(6);
    expect(s.noised).toBe(true); // 6 is in [5,20)
    expect(s.calibration).toEqual({ hits: 12, misses: 6, resolved: 18, score: 0.67 });
    // The published figures are aggregate quartiles, carrying no tenant identity.
    expect(s.realizedUsd.p50).toBeGreaterThan(0);
    expect("tenantId" in s).toBe(false);
  });

  it("does not noise a cohort at or above the noise band", () => {
    const contributions = Array.from({ length: 20 }, (_v, i) =>
      contribution({ realizedUsd: 100_000 + i * 1_000 }),
    );
    const studies = buildCaseStudies(contributions, { minCohort: 5, noiseBand: 20 });
    expect(studies[0]!.noised).toBe(false);
  });

  it("groups multiple segments and sorts by segment key", () => {
    const a = Array.from({ length: 5 }, () => contribution({ segmentKey: "a|x", sector: "a", revenueBand: "x" }));
    const b = Array.from({ length: 5 }, () => contribution({ segmentKey: "b|y", sector: "b", revenueBand: "y" }));
    const studies = buildCaseStudies([...b, ...a], { minCohort: 5, noiseBand: 20, rng: () => 0.5 });
    expect(studies.map((s) => s.segmentKey)).toEqual(["a|x", "b|y"]);
  });
});
