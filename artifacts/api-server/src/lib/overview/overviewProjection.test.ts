import { describe, expect, it } from "vitest";
import {
  buildOverviewItem,
  projectVoice,
  toPublicDiagnosisLayer,
  type OverviewRow,
} from "./overviewProjection";

function generatedRow(overrides: Partial<OverviewRow> = {}): OverviewRow {
  return {
    key: "revenue",
    name: "Revenue Engine",
    archetype: "growth",
    ownerPersona: "CRO",
    moduleGroup: "commercial",
    sortOrder: 1,
    diagnosticQuestion: "Is the pipeline real?",
    feeds: ["forecast"],
    content: {
      narrative: "Coverage is thin.",
      headline_finding: "Coverage is 2.1x.",
      headline_impact: "1.8 million dollars exposed.",
      headline_lever: "Fix hygiene.",
      confidence: 70,
      confidence_gap: 18,
      metrics: [{ label: "Coverage", value: "2.1x", sub: "vs 3.5x", tone: "bad" }],
      actions: [
        { title: "Clean pipeline", impact: "Recover coverage", timing: "2 weeks", confidence: 68, basis: "modelled" },
      ],
      gaps: [
        { kind: "DATA", description: "No call notes", closes: "intent", confidence_lift_pp: 12 },
        { kind: "SIGNAL", description: "Stale stages", closes: "freshness", confidence_lift_pp: 4 },
      ],
    },
    heroPanel: {
      metric_label: "Coverage",
      metric_value: "2.1x",
      metric_sub: "below target",
      tone: "bad",
      one_line_read: "Forecast at risk.",
    },
    voiceQuality: { score: 86, band: "strong", passed: true },
    generatedAt: new Date("2026-01-01T00:00:00Z"),
    generatorModel: "narrate-model",
    ...overrides,
  };
}

describe("buildOverviewItem", () => {
  it("projects a generated layer with its lead metric, top action, top gap and voice", () => {
    const item = buildOverviewItem(generatedRow());
    expect(item.generated).toBe(true);
    expect(item.headlineFinding).toBe("Coverage is 2.1x.");
    expect(item.leadMetric?.value).toBe("2.1x");
    expect(item.topAction?.title).toBe("Clean pipeline");
    // The top gap is the highest confidence_lift_pp, not the first.
    expect(item.topGap?.confidenceLiftPp).toBe(12);
    expect(item.voice).toEqual({ score: 86, band: "strong", passed: true });
  });

  it("yields honest nulls for an ungenerated layer, never placeholders", () => {
    const item = buildOverviewItem(
      generatedRow({ content: null, heroPanel: null, voiceQuality: null, generatedAt: null, generatorModel: null }),
    );
    expect(item.generated).toBe(false);
    expect(item.headlineFinding).toBeNull();
    expect(item.leadMetric).toBeNull();
    expect(item.topAction).toBeNull();
    expect(item.topGap).toBeNull();
    expect(item.voice).toBeNull();
  });

  it("nulls a malformed voice report rather than fabricating a pass", () => {
    expect(projectVoice(null)).toBeNull();
    expect(projectVoice({ band: "strong", passed: true })).toBeNull();
    expect(projectVoice({ score: 50, band: "weak", passed: false })).toEqual({
      score: 50,
      band: "weak",
      passed: false,
    });
  });
});

describe("toPublicDiagnosisLayer", () => {
  it("strips internal routing fields the public must not see", () => {
    const item = buildOverviewItem(generatedRow());
    const pub = toPublicDiagnosisLayer(item);
    expect("ownerPersona" in pub).toBe(false);
    expect("diagnosticQuestion" in pub).toBe(false);
    expect("feeds" in pub).toBe(false);
    // The board-pack-level read survives.
    expect(pub.headlineFinding).toBe("Coverage is 2.1x.");
    expect(pub.voice?.passed).toBe(true);
  });
});
