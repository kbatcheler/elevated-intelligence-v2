import { describe, expect, it } from "vitest";
import { evaluateNarrativeVoice, VOICE_BAR } from "./voice";
import type { LayerContent } from "../schemas/content";

// A strong, plain, data-grounded layer: short-to-medium sentences, no hype, no
// first person, several figures, proof, and a named gap.
function strongContent(): LayerContent {
  return {
    narrative:
      "Pipeline coverage sits at 2.1x against a 3.5x target. The gap traces to 42 stalled " +
      "deals worth 1.8 million dollars. Hygiene is the binding constraint, not demand. " +
      "Close that and forecast risk drops sharply.",
    headline_finding: "Pipeline coverage is 2.1x, well under the 3.5x the plan assumes.",
    headline_impact: "About 1.8 million dollars of forecast is exposed to stalled deals.",
    headline_lever: "Fix stage hygiene on 42 deals to restore coverage to target.",
    causes: [
      {
        title: "Stage hygiene has decayed",
        impact: "Coverage understated by roughly 40 percent",
        detail: "Reps skip stage updates, so 42 deals read as stalled when several are live.",
        confidence: 72,
        basis: "modelled",
      },
    ],
    actions: [
      {
        title: "Run a 2 week pipeline cleanup",
        detail: "Audit the 42 stalled deals and reset stages against the last real activity.",
        impact: "Recovers an estimated 1.8 million dollars of visible coverage",
        confidence: 68,
        basis: "modelled",
      },
    ],
    hypotheses: [],
    proof: {
      items: [
        {
          source: "CRM export, last 90 days",
          observation: "42 of 110 open deals had no stage change in over 30 days.",
        },
      ],
    },
    gaps: [
      {
        kind: "missing_data",
        description: "No call notes are connected, so intent behind the stall is inferred.",
      },
    ],
    metrics: [
      { label: "Coverage", value: "2.1x", tone: "negative" },
      { label: "Target", value: "3.5x", tone: "neutral" },
    ],
    confidence: 70,
    confidence_gap: 18,
  };
}

describe("evaluateNarrativeVoice", () => {
  it("scores a plain, data-grounded layer at or above the bar", () => {
    const report = evaluateNarrativeVoice(strongContent());
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(VOICE_BAR);
    expect(["adequate", "strong"]).toContain(report.band);
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual([]);
  });

  it("flags marketing hype and first-person voice without mutating content", () => {
    const base = strongContent();
    const hyped: LayerContent = {
      ...base,
      narrative:
        "We built a revolutionary, world-class engine. Our seamless platform is a game-changer.",
    };
    const report = evaluateNarrativeVoice(hyped);
    const byId = new Map(report.checks.map((c) => [c.id, c]));
    expect(byId.get("no_hype")?.passed).toBe(false);
    expect(byId.get("no_first_person")?.passed).toBe(false);
    // The evaluator never edits: the input narrative is unchanged.
    expect(hyped.narrative).toContain("revolutionary");
  });

  it("is deterministic", () => {
    const c = strongContent();
    expect(evaluateNarrativeVoice(c)).toEqual(evaluateNarrativeVoice(c));
  });

  it("catches a long dash that slipped into prose", () => {
    const base = strongContent();
    const withDash: LayerContent = {
      ...base,
      narrative: base.narrative + " Coverage \u2014 the real constraint \u2014 must rise.",
    };
    const report = evaluateNarrativeVoice(withDash);
    const noDash = report.checks.find((c) => c.id === "no_long_dash");
    expect(noDash?.passed).toBe(false);
  });

  it("reports weak when most checks fail", () => {
    const weak: LayerContent = {
      narrative: "We unlocked synergies.",
      headline_finding: "Our seamless paradigm is revolutionary and world-class for everyone here.",
      headline_impact: "Effortless gains across the board for the whole team now.",
      headline_lever: "Supercharge the disruptive, cutting-edge platform we built together today.",
      causes: [
        {
          title: "Vague cause",
          impact: "Unclear",
          detail: "Something happened that we think matters a lot for the business overall.",
          confidence: 30,
          basis: "modelled",
        },
      ],
      actions: [
        {
          title: "Do better",
          detail: "We will leverage our world-class synergy to disrupt the market seamlessly.",
          impact: "Big",
          confidence: 20,
          basis: "modelled",
        },
      ],
      hypotheses: [],
      proof: { items: [] },
      gaps: [],
      metrics: [{ label: "Vibes", value: "high", tone: "positive" }],
      confidence: 20,
      confidence_gap: 60,
    };
    const report = evaluateNarrativeVoice(weak);
    expect(report.passed).toBe(false);
    expect(report.band).toBe("weak");
  });
});
