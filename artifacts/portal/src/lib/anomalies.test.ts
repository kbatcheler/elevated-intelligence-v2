import { describe, expect, it } from "vitest";
import type { PipelineRun, SignalLayer } from "../types";
import { deriveAnomalies } from "./anomalies";

function signal(partial: Partial<SignalLayer>): SignalLayer {
  return {
    key: "k",
    name: "K",
    moduleGroup: "m",
    feeds: [],
    sortOrder: 1,
    ownerPersona: "",
    generated: true,
    headlineFinding: null,
    headlineImpact: null,
    headlineLever: null,
    confidence: null,
    confidenceGap: null,
    causes: [],
    actions: [],
    gaps: [],
    hypotheses: [],
    confounders: [],
    verifiedCount: 0,
    modelledCount: 0,
    generatedAt: null,
    generatorModel: null,
    ...partial,
  };
}

function run(partial: Partial<PipelineRun>): PipelineRun {
  return {
    id: "r",
    layerKey: "k",
    status: "done",
    startedAt: null,
    finishedAt: null,
    error: null,
    subStages: [],
    ...partial,
  };
}

describe("deriveAnomalies", () => {
  it("never mines an ungenerated layer", () => {
    const s = signal({
      generated: false,
      confounders: [
        { rank: 1, name: "Promo", mechanism: "m", directionalImpact: "d", verdict: "unresolved", reason: "r" },
      ],
      actions: [{ title: "Act", impact: "i", timing: "t", owner: "o", basis: "modelled", confidence: 10 }],
      gaps: [{ kind: "DATA", description: "g", closes: "c", confidenceLiftPp: 9 }],
    });
    expect(deriveAnomalies([s], [])).toEqual([]);
  });

  it("flags only partial and unresolved confounders, unresolved before partial, then by rank", () => {
    const s = signal({
      confounders: [
        { rank: 2, name: "Partial-2", mechanism: "m", directionalImpact: "d", verdict: "partial", reason: "r" },
        { rank: 1, name: "RuledOut", mechanism: "m", directionalImpact: "d", verdict: "ruled_out", reason: "r" },
        { rank: 3, name: "Unresolved-3", mechanism: "m", directionalImpact: "d", verdict: "unresolved", reason: "r" },
        { rank: 1, name: "Partial-1", mechanism: "m", directionalImpact: "d", verdict: "partial", reason: "r" },
      ],
    });
    const titles = deriveAnomalies([s], []).map((a) => a.title);
    // ruled_out excluded; unresolved leads; partials then by ascending rank.
    expect(titles).toEqual(["Unresolved-3", "Partial-1", "Partial-2"]);
  });

  it("flags modelled actions below the threshold, ranked by ascending confidence", () => {
    const s = signal({
      actions: [
        { title: "Low", impact: "i", timing: "t", owner: "o", basis: "modelled", confidence: 30 },
        { title: "Lower", impact: "i", timing: "t", owner: "o", basis: "modelled", confidence: 15 },
        { title: "AtThreshold", impact: "i", timing: "t", owner: "o", basis: "modelled", confidence: 60 },
        { title: "Verified", impact: "i", timing: "t", owner: "o", basis: "verified", confidence: 5 },
      ],
    });
    const flagged = deriveAnomalies([s], []).filter((a) => a.kind === "low-confidence-action");
    expect(flagged.map((a) => a.title)).toEqual(["Lower", "Low"]);
    expect(flagged.map((a) => a.metric)).toEqual([15, 30]);
    expect(flagged[0].metricLabel).toBe("confidence");
  });

  it("respects a custom confidence threshold", () => {
    const s = signal({
      actions: [{ title: "A", impact: "i", timing: "t", owner: "o", basis: "modelled", confidence: 65 }],
    });
    expect(deriveAnomalies([s], [], { confidenceThreshold: 60 })).toHaveLength(0);
    expect(deriveAnomalies([s], [], { confidenceThreshold: 70 })).toHaveLength(1);
  });

  it("ranks gaps by descending confidence lift and surfaces the real figure", () => {
    const s = signal({
      gaps: [
        { kind: "DATA", description: "Small", closes: "c", confidenceLiftPp: 4 },
        { kind: "SIGNAL", description: "Big", closes: "c", confidenceLiftPp: 12 },
        { kind: "MODEL", description: "NoFigure", closes: "c", confidenceLiftPp: null },
      ],
    });
    const flagged = deriveAnomalies([s], []).filter((a) => a.kind === "open-gap");
    expect(flagged.map((a) => a.title)).toEqual(["Big", "Small"]);
    expect(flagged.map((a) => a.metric)).toEqual([12, 4]);
  });

  it("flags an errored run or errored sub-stage and leads the inbox with it", () => {
    const s = signal({
      gaps: [{ kind: "DATA", description: "g", closes: "c", confidenceLiftPp: 5 }],
    });
    const runs = [
      run({
        layerKey: "k",
        status: "running",
        subStages: [
          { name: "narrate", status: "error", durationMs: null, error: "timeout", telemetry: null },
        ],
      }),
    ];
    const out = deriveAnomalies([s], runs);
    expect(out[0].kind).toBe("errored-run");
    expect(out[0].layerKey).toBe("k");
    expect(out[0].detail).toContain("narrate");
    // The gap still appears, but after the errored run.
    expect(out.some((a) => a.kind === "open-gap")).toBe(true);
  });

  it("orders categories errored-run, confounder, low-action, gap and carries layer identity", () => {
    const s = signal({
      key: "finance",
      name: "Finance",
      confounders: [
        { rank: 1, name: "C", mechanism: "m", directionalImpact: "d", verdict: "unresolved", reason: "r" },
      ],
      actions: [{ title: "A", impact: "i", timing: "t", owner: "o", basis: "modelled", confidence: 10 }],
      gaps: [{ kind: "DATA", description: "G", closes: "c", confidenceLiftPp: 5 }],
    });
    const runs = [run({ layerKey: "finance", status: "error", error: "boom" })];
    const kinds = deriveAnomalies([s], runs).map((a) => a.kind);
    expect(kinds).toEqual([
      "errored-run",
      "unresolved-confounder",
      "low-confidence-action",
      "open-gap",
    ]);
    for (const a of deriveAnomalies([s], runs)) {
      expect(a.layerKey).toBe("finance");
      expect(a.layerName).toBe("Finance");
    }
  });
});
