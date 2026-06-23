import { describe, expect, it } from "vitest";
import { SCORED_QUESTIONS } from "./questions";
import {
  bandFor,
  buildCostFraming,
  buildNarrative,
  computeScores,
  selectGapLayers,
} from "./scoring";

// The honesty contract for the Intelligence Gap Assessment scoring, proven with
// pure functions and no database: a strong operation passes, a flying-blind one
// reads as blind, the gap to layer mapping is driven only by the prospect's own
// weak answers, and the cost framing never invents a figure.

const allAnswers = (rung: "blind" | "partial" | "ahead"): Record<string, "blind" | "partial" | "ahead"> =>
  Object.fromEntries(SCORED_QUESTIONS.map((q) => [q.id, rung]));

describe("bandFor", () => {
  it("maps the score range onto blind, reactive and ahead", () => {
    expect(bandFor(0)).toBe("blind");
    expect(bandFor(33)).toBe("blind");
    expect(bandFor(34)).toBe("reactive");
    expect(bandFor(66)).toBe("reactive");
    expect(bandFor(67)).toBe("ahead");
    expect(bandFor(100)).toBe("ahead");
  });
});

describe("computeScores", () => {
  it("a strong operation passes: every dimension and the overall land ahead at 100", () => {
    const scores = computeScores(allAnswers("ahead"));
    expect(scores.overall.score).toBe(100);
    expect(scores.overall.band).toBe("ahead");
    for (const d of scores.dimensions) {
      expect(d.score).toBe(100);
      expect(d.band).toBe("ahead");
    }
    expect(scores.dimensions).toHaveLength(4);
  });

  it("a flying-blind operation reads blind: every dimension and the overall are 0", () => {
    const scores = computeScores(allAnswers("blind"));
    expect(scores.overall.score).toBe(0);
    expect(scores.overall.band).toBe("blind");
    for (const d of scores.dimensions) {
      expect(d.score).toBe(0);
      expect(d.band).toBe("blind");
    }
  });

  it("the middle rung lands reactive across the board", () => {
    const scores = computeScores(allAnswers("partial"));
    expect(scores.overall.score).toBe(50);
    expect(scores.overall.band).toBe("reactive");
  });
});

describe("selectGapLayers", () => {
  it("a perfect set points at no layers, so the report invents no gap", () => {
    expect(selectGapLayers(allAnswers("ahead"))).toEqual([]);
  });

  it("a blind set points at the tagged canonical layers, ranked by weakness", () => {
    const selection = selectGapLayers(allAnswers("blind"));
    expect(selection.length).toBeGreaterThan(0);
    const keys = selection.map((s) => s.layerKey);
    // Only keys that a question is actually tagged with may appear.
    const tagged = new Set(SCORED_QUESTIONS.flatMap((q) => q.layerKeys));
    for (const k of keys) expect(tagged.has(k)).toBe(true);
    // finance is tagged by several questions, so it surfaces near the top.
    expect(keys).toContain("finance");
    // Weights are sorted descending.
    for (let i = 1; i < selection.length; i += 1) {
      expect(selection[i - 1].weight).toBeGreaterThanOrEqual(selection[i].weight);
    }
  });

  it("a blind answer weighs more than a partial answer", () => {
    const oneBlind = { ...allAnswers("ahead"), [SCORED_QUESTIONS[0].id]: "blind" as const };
    const onePartial = { ...allAnswers("ahead"), [SCORED_QUESTIONS[0].id]: "partial" as const };
    const blindWeight = selectGapLayers(oneBlind)[0]?.weight ?? 0;
    const partialWeight = selectGapLayers(onePartial)[0]?.weight ?? 0;
    expect(blindWeight).toBe(2);
    expect(partialWeight).toBe(1);
  });
});

describe("buildNarrative", () => {
  it("flips the message for a strong scorer to concentration, not blindness", () => {
    const n = buildNarrative(computeScores(allAnswers("ahead")));
    expect(n.headline.toLowerCase()).toContain("ahead");
    expect(n.paragraphs.join(" ").toLowerCase()).toContain("concentration");
  });

  it("names a real gap for a blind scorer", () => {
    const n = buildNarrative(computeScores(allAnswers("blind")));
    expect(n.headline.length).toBeGreaterThan(0);
    expect(n.paragraphs.length).toBeGreaterThan(0);
  });
});

describe("buildCostFraming", () => {
  it("never invents a figure: no digit and no currency symbol in any line", () => {
    for (const rung of ["blind", "partial", "ahead"] as const) {
      const framing = buildCostFraming(computeScores(allAnswers(rung)), "20m_100m");
      for (const line of framing.lines) {
        expect(line).not.toMatch(/\d/);
        expect(line).not.toContain("$");
      }
    }
  });

  it("is honest that no precise figure is available for a weak result", () => {
    const framing = buildCostFraming(computeScores(allAnswers("blind")), "5m_20m");
    expect(framing.lines.join(" ").toLowerCase()).toContain("not");
  });
});
