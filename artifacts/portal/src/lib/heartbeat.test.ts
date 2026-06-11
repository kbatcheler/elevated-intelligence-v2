import { describe, expect, it } from "vitest";
import type { PipelineRun, SignalLayer } from "../types";
import { deriveHeartbeat } from "./heartbeat";

function signal(partial: Partial<SignalLayer>): SignalLayer {
  return {
    key: "k",
    name: "K",
    moduleGroup: "",
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

describe("deriveHeartbeat", () => {
  it("maps each feed to the layers that consume it, in registry order", () => {
    const a = signal({ key: "a", name: "A", feeds: ["stripe", "ga4"], sortOrder: 2 });
    const b = signal({ key: "b", name: "B", feeds: ["stripe"], sortOrder: 1 });
    const pulses = deriveHeartbeat([a, b], []);
    const stripe = pulses.find((p) => p.feed === "stripe");
    expect(stripe?.consumingLayers.map((l) => l.key)).toEqual(["b", "a"]);
    expect(pulses.map((p) => p.feed).sort()).toEqual(["ga4", "stripe"]);
  });

  it("sums real search calls and durations and takes the latest finishedAt", () => {
    const a = signal({ key: "a", name: "A", feeds: ["stripe"], sortOrder: 1 });
    const runs = [
      run({
        id: "r1",
        layerKey: "a",
        finishedAt: "2026-06-01T10:00:00.000Z",
        subStages: [
          { name: "perceive", status: "done", durationMs: 100, error: null, telemetry: { searchCalls: 2 } },
          { name: "narrate", status: "done", durationMs: 50, error: null, telemetry: null },
        ],
      }),
      run({
        id: "r2",
        layerKey: "a",
        finishedAt: "2026-06-02T10:00:00.000Z",
        subStages: [
          { name: "perceive", status: "done", durationMs: 70, error: null, telemetry: { searchCalls: 3 } },
        ],
      }),
    ];
    const pulse = deriveHeartbeat([a], runs)[0];
    expect(pulse.runCount).toBe(2);
    expect(pulse.searchCalls).toBe(5);
    expect(pulse.totalDurationMs).toBe(220);
    expect(pulse.lastFinishedAt).toBe("2026-06-02T10:00:00.000Z");
  });

  it("reports honest null/zero activity for a feed whose layers never ran", () => {
    const a = signal({ key: "a", feeds: ["cold-feed"], sortOrder: 1 });
    const pulse = deriveHeartbeat([a], [])[0];
    expect(pulse).toMatchObject({
      feed: "cold-feed",
      lastFinishedAt: null,
      runCount: 0,
      searchCalls: 0,
      totalDurationMs: 0,
    });
  });

  it("orders most recently active feeds first and never-run feeds last", () => {
    const a = signal({ key: "a", feeds: ["recent"], sortOrder: 1 });
    const b = signal({ key: "b", feeds: ["older"], sortOrder: 2 });
    const c = signal({ key: "c", feeds: ["cold"], sortOrder: 3 });
    const runs = [
      run({ layerKey: "a", finishedAt: "2026-06-05T00:00:00.000Z" }),
      run({ layerKey: "b", finishedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(deriveHeartbeat([a, b, c], runs).map((p) => p.feed)).toEqual(["recent", "older", "cold"]);
  });
});
