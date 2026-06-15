import { describe, expect, it } from "vitest";
import {
  type ActionValue,
  type MeasurementValue,
  computeCalibration,
  computeOutcomeSummary,
  computeVariance,
  deriveMeasurementStatus,
  latestMeasurementPerAction,
  toNum,
} from "./outcomeMath";

describe("toNum", () => {
  it("parses database numeric strings and passes through numbers", () => {
    expect(toNum("2400000.00")).toBe(2_400_000);
    expect(toNum(750)).toBe(750);
  });
  it("returns null for null, undefined, or non-numeric", () => {
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum("not-a-number")).toBeNull();
  });
});

describe("deriveMeasurementStatus", () => {
  it("is pending when no realized value is recorded", () => {
    expect(deriveMeasurementStatus({ predictedValueUsd: 100, realizedValueUsd: null, final: false })).toBe("pending");
  });
  it("is realized when the realized value meets or exceeds the prediction", () => {
    expect(deriveMeasurementStatus({ predictedValueUsd: 100, realizedValueUsd: 100, final: false })).toBe("realized");
    expect(deriveMeasurementStatus({ predictedValueUsd: 100, realizedValueUsd: 140, final: true })).toBe("realized");
  });
  it("is on_track when progressing below the prediction and not final", () => {
    expect(deriveMeasurementStatus({ predictedValueUsd: 100, realizedValueUsd: 60, final: false })).toBe("on_track");
  });
  it("is missed only when a final measurement closes out below the prediction", () => {
    expect(deriveMeasurementStatus({ predictedValueUsd: 100, realizedValueUsd: 60, final: true })).toBe("missed");
  });
  it("never grades a realized value as missed without a numeric prediction", () => {
    expect(deriveMeasurementStatus({ predictedValueUsd: null, realizedValueUsd: 60, final: true })).toBe("on_track");
  });
});

describe("computeVariance", () => {
  it("subtracts prediction from realized when both are present", () => {
    expect(computeVariance(140, 100)).toBe(40);
    expect(computeVariance(60, 100)).toBe(-40);
  });
  it("is null when either side is absent", () => {
    expect(computeVariance(null, 100)).toBeNull();
    expect(computeVariance(140, null)).toBeNull();
  });
});

describe("latestMeasurementPerAction", () => {
  it("keeps only the most recent measurement per action", () => {
    const ms: MeasurementValue[] = [
      { actionId: "a", realizedValueUsd: 10, status: "on_track", measuredAt: 1, createdAt: 1 },
      { actionId: "a", realizedValueUsd: 50, status: "realized", measuredAt: 2, createdAt: 2 },
      { actionId: "b", realizedValueUsd: 5, status: "on_track", measuredAt: 1, createdAt: 1 },
    ];
    const latest = latestMeasurementPerAction(ms);
    expect(latest).toHaveLength(2);
    const a = latest.find((m) => m.actionId === "a");
    expect(a?.realizedValueUsd).toBe(50);
    expect(a?.status).toBe("realized");
  });
});

describe("computeCalibration", () => {
  it("scores hits over resolved and surfaces misses", () => {
    const latest: MeasurementValue[] = [
      { actionId: "a", realizedValueUsd: 50, status: "realized", measuredAt: 2, createdAt: 2 },
      { actionId: "b", realizedValueUsd: 10, status: "missed", measuredAt: 2, createdAt: 2 },
      { actionId: "c", realizedValueUsd: 5, status: "on_track", measuredAt: 1, createdAt: 1 },
      { actionId: "d", realizedValueUsd: null, status: "pending", measuredAt: 1, createdAt: 1 },
    ];
    expect(computeCalibration(latest)).toEqual({ score: 0.5, hits: 1, misses: 1, resolved: 2 });
  });
  it("has a null score when nothing has resolved", () => {
    const latest: MeasurementValue[] = [
      { actionId: "a", realizedValueUsd: 5, status: "on_track", measuredAt: 1, createdAt: 1 },
    ];
    expect(computeCalibration(latest)).toEqual({ score: null, hits: 0, misses: 0, resolved: 0 });
  });
});

describe("computeOutcomeSummary", () => {
  it("sums identified and realized value and grades calibration from latest measurements", () => {
    const actions: ActionValue[] = [
      { id: "a", predictedValueUsd: 100, status: "committed" },
      { id: "b", predictedValueUsd: 200, status: "in_progress" },
      { id: "c", predictedValueUsd: 50, status: "dismissed" },
      { id: "d", predictedValueUsd: null, status: "committed" },
    ];
    const measurements: MeasurementValue[] = [
      { actionId: "a", realizedValueUsd: 40, status: "on_track", measuredAt: 1, createdAt: 1 },
      { actionId: "a", realizedValueUsd: 120, status: "realized", measuredAt: 2, createdAt: 2 },
      { actionId: "b", realizedValueUsd: 150, status: "missed", measuredAt: 1, createdAt: 1 },
    ];
    const summary = computeOutcomeSummary(actions, measurements);
    // Identified excludes the dismissed action and the action with no numeric prediction.
    expect(summary.valueIdentifiedUsd).toBe(300);
    // Realized counts only the latest measurement per action: 120 (a) + 150 (b).
    expect(summary.valueRealizedUsd).toBe(270);
    expect(summary.actionsWithPrediction).toBe(2);
    expect(summary.actionsMeasured).toBe(2);
    expect(summary.calibration).toEqual({ score: 0.5, hits: 1, misses: 1, resolved: 2 });
  });

  it("is all zeros and null score for a tenant with no graded actions", () => {
    const summary = computeOutcomeSummary([], []);
    expect(summary).toEqual({
      valueIdentifiedUsd: 0,
      valueRealizedUsd: 0,
      actionsWithPrediction: 0,
      actionsMeasured: 0,
      calibration: { score: null, hits: 0, misses: 0, resolved: 0 },
    });
  });
});
