import { describe, expect, it } from "vitest";
import type { PipelineRun, SeatTelemetry, SubStage } from "../types";
import { aggregateBySeat, isSovereignRun, stageStatusColor } from "./reasoningTelemetry";

function stage(name: string, durationMs: number | null, telemetry: SeatTelemetry | null): SubStage {
  return { name, status: "done", durationMs, error: null, telemetry };
}

function run(subStages: SubStage[]): PipelineRun {
  return {
    id: `run-${subStages.map((s) => s.name).join("-")}`,
    layerKey: "business-performance",
    status: "done",
    startedAt: null,
    finishedAt: null,
    error: null,
    subStages,
  };
}

describe("aggregateBySeat", () => {
  it("does not triple-count the Evaluator's single batched enrichment call", () => {
    // hero carries the real cost of the one Haiku call; peers and supplements are
    // marked batched, so their cost must NOT be added even though they are real
    // sub-stages the seat produced.
    const runs = [
      run([
        stage("score", 200, { seat: "Evaluator", inputTokens: 100, outputTokens: 50, latencyMs: 200 }),
        stage("hero", 500, { seat: "Enrichment", inputTokens: 300, outputTokens: 150, latencyMs: 500 }),
        stage("peers", 0, { seat: "Enrichment", model: "claude-haiku-4-5", latencyMs: 0, batched: true }),
        stage("supplements", 0, { seat: "Enrichment", model: "claude-haiku-4-5", latencyMs: 0, batched: true }),
      ]),
    ];

    const agg = aggregateBySeat(runs);

    const enrichment = agg.get("Enrichment");
    expect(enrichment).toBeDefined();
    // Three distinct artefacts were produced, so three stages are counted.
    expect(enrichment!.stages).toBe(3);
    // But only the one batched call's cost is counted, recorded on hero.
    expect(enrichment!.inputTokens).toBe(300);
    expect(enrichment!.outputTokens).toBe(150);
    expect(enrichment!.durationMs).toBe(500);

    // The Evaluator (score) is its own separate call and is unaffected.
    expect(agg.get("Evaluator")).toEqual({
      stages: 1,
      inputTokens: 100,
      outputTokens: 50,
      searchCalls: 0,
      durationMs: 200,
    });
  });

  it("ignores cost on a batched stage even if tokens are erroneously present", () => {
    const runs = [
      run([
        stage("hero", 500, { seat: "Enrichment", inputTokens: 300, outputTokens: 150, latencyMs: 500 }),
        // Defensive: a batched stage must never contribute cost, regardless of
        // what stray numbers it carries.
        stage("peers", 999, { seat: "Enrichment", inputTokens: 999, outputTokens: 999, batched: true }),
      ]),
    ];

    const enrichment = aggregateBySeat(runs).get("Enrichment");
    expect(enrichment).toEqual({
      stages: 2,
      inputTokens: 300,
      outputTokens: 150,
      searchCalls: 0,
      durationMs: 500,
    });
  });

  it("skips sub-stages with no seat telemetry rather than inventing an aggregate", () => {
    const runs = [run([stage("perceive", null, null), stage("hypothesise", 100, { seat: "Lens", latencyMs: 100 })])];
    const agg = aggregateBySeat(runs);
    expect(agg.has("Lens")).toBe(true);
    expect(agg.size).toBe(1);
  });
});

describe("stageStatusColor", () => {
  it("maps every sub-stage status to a distinct dot color", () => {
    expect(stageStatusColor("done")).toBe("var(--teal)");
    expect(stageStatusColor("running")).toBe("var(--blue)");
    expect(stageStatusColor("error")).toBe("var(--coral)");
    // pending and skipped share the muted slate, by design.
    expect(stageStatusColor("pending")).toBe("var(--slate-light)");
    expect(stageStatusColor("skipped")).toBe("var(--slate-light)");
  });
});

describe("isSovereignRun", () => {
  it("is true only when a sub-stage actually recorded a sovereign execution mode", () => {
    const sovereign = [stage("perceive", 10, { seat: "Lens", latencyMs: 10, executionMode: "sovereign" })];
    expect(isSovereignRun(sovereign)).toBe(true);
  });

  it("is false for an outside_in/connected run that recorded no marker", () => {
    const connected = [stage("perceive", 10, { seat: "Lens", latencyMs: 10 })];
    expect(isSovereignRun(connected)).toBe(false);
    expect(isSovereignRun([stage("perceive", null, null)])).toBe(false);
    expect(isSovereignRun([])).toBe(false);
  });
});
