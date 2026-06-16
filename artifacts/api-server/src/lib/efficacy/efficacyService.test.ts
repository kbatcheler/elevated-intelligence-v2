import { describe, expect, it } from "vitest";
import { efficacyConfig } from "./config";
import { buildLayerEfficacy, type LayerEfficacyInput } from "./efficacyService";

// These unit tests pin the driver wiring of the read-time service to the pure
// math core, without a database: every acceptance behaviour (coverage rises when
// a feed connects, adversarial survival rises when a confounder is ruled out,
// and outside-in vs connected differ honestly) is proven deterministically here.
const CFG = efficacyConfig({} as NodeJS.ProcessEnv);
const NOW = Date.UTC(2026, 5, 16, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

// GA4 maps to marketing-web-analytics, CRM to crm-sales; News maps to nothing,
// so it is excluded from the coverage denominator (mappable feeds = 2).
const FEEDS = ["GA4", "CRM", "News"];

function input(overrides: Partial<LayerEfficacyInput> = {}): LayerEfficacyInput {
  return {
    layerKey: "marketing-performance",
    feeds: FEEDS,
    generated: true,
    reducedMode: false,
    verifiedItems: [
      { source_urls: ["https://a.com/x"] },
      { source_urls: ["https://b.com/y"] },
      { source_urls: ["https://c.com/z"] },
      { source_urls: ["https://a.com/again"] },
    ],
    modelledItems: [],
    confounders: [{ verdict: "ruled_out" }, { verdict: "ruled_out" }],
    signals: [
      { sourceConnectorKey: "google-analytics-4", computedAt: NOW },
      { sourceConnectorKey: "salesforce", computedAt: NOW },
    ],
    ...overrides,
  };
}

describe("buildLayerEfficacy", () => {
  it("returns null for a layer not generated for the tenant", () => {
    expect(buildLayerEfficacy(input({ generated: false }), "connected", CFG, NOW)).toBeNull();
  });

  it("scores a fully connected, fully measured layer at 100 with no improvement left", () => {
    const idx = buildLayerEfficacy(input(), "connected", CFG, NOW)!;
    expect(idx.score).toBe(100);
    expect(idx.modeCeiling).toBe(100);
    expect(idx.unknownWeight).toBe(0);
    expect(idx.cheapestImprovement).toBeNull();
    const coverage = idx.drivers.find((d) => d.key === "coverage")!;
    expect(coverage.value).toBe(1);
    expect(coverage.status).toBe("measured");
  });

  it("raises coverage and the score when a missing feed gains a connected signal", () => {
    const before = buildLayerEfficacy(
      input({ signals: [{ sourceConnectorKey: "google-analytics-4", computedAt: NOW }] }),
      "connected",
      CFG,
      NOW,
    )!;
    const after = buildLayerEfficacy(input(), "connected", CFG, NOW)!;
    const covBefore = before.drivers.find((d) => d.key === "coverage")!;
    const covAfter = after.drivers.find((d) => d.key === "coverage")!;
    expect(covBefore.value).toBe(0.5); // GA4 covered, CRM missing
    expect(covAfter.value).toBe(1);
    expect(after.score).toBeGreaterThan(before.score);
    // With CRM still missing, connecting it is the named cheapest improvement.
    expect(before.cheapestImprovement?.driver).toBe("coverage");
    expect(before.cheapestImprovement?.hint).toContain("CRM");
  });

  it("raises adversarial survival when confounders are ruled out", () => {
    const open = buildLayerEfficacy(
      input({ confounders: [{ verdict: "unresolved" }, { verdict: "partial" }] }),
      "connected",
      CFG,
      NOW,
    )!;
    const resolved = buildLayerEfficacy(input(), "connected", CFG, NOW)!;
    const sOpen = open.drivers.find((d) => d.key === "adversarialSurvival")!;
    const sResolved = resolved.drivers.find((d) => d.key === "adversarialSurvival")!;
    expect(sOpen.value).toBe(0);
    expect(sResolved.value).toBe(1);
    expect(resolved.score).toBeGreaterThan(open.score);
  });

  it("decays freshness with the age of the newest signal", () => {
    const dayOld = buildLayerEfficacy(
      input({
        signals: [
          { sourceConnectorKey: "google-analytics-4", computedAt: NOW - 24 * HOUR },
          { sourceConnectorKey: "salesforce", computedAt: NOW - 48 * HOUR },
        ],
      }),
      "connected",
      CFG,
      NOW,
    )!;
    const freshness = dayOld.drivers.find((d) => d.key === "freshness")!;
    // Newest signal is 24h old: a single half-life, so 0.5.
    expect(freshness.value).toBe(0.5);
  });

  it("differs honestly between outside-in and connected for the same evidence", () => {
    // Outside-in has no connected signals, so coverage is a measured zero and
    // freshness is genuinely not measured; the mode ceiling is structurally lower.
    const outsideIn = buildLayerEfficacy(input({ signals: [] }), "outside_in", CFG, NOW)!;
    const connected = buildLayerEfficacy(input(), "connected", CFG, NOW)!;

    expect(outsideIn.modeCeiling).toBe(60);
    expect(connected.modeCeiling).toBe(100);
    expect(outsideIn.score).toBeLessThan(connected.score);
    expect(outsideIn.score).toBeLessThanOrEqual(outsideIn.modeCeiling);

    const ocov = outsideIn.drivers.find((d) => d.key === "coverage")!;
    expect(ocov.value).toBe(0);
    expect(ocov.status).toBe("measured");
    const ofresh = outsideIn.drivers.find((d) => d.key === "freshness")!;
    expect(ofresh.status).toBe("not_measured");
    expect(outsideIn.unknownWeight).toBeGreaterThan(0);

    // The biggest lever in outside-in is connecting data.
    expect(outsideIn.cheapestImprovement?.driver).toBe("coverage");
    expect(outsideIn.cheapestImprovement?.hint).toContain("Connect your data");
  });

  it("marks the Confounder stage not measured for a reduced express build", () => {
    const idx = buildLayerEfficacy(input({ reducedMode: true, confounders: [] }), "connected", CFG, NOW)!;
    const surv = idx.drivers.find((d) => d.key === "adversarialSurvival")!;
    expect(surv.status).toBe("not_measured");
    expect(surv.value).toBeNull();
    expect(idx.cheapestImprovement).not.toBeNull();
  });
});
