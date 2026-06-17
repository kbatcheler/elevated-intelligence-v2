import { describe, expect, it } from "vitest";
import type { CalibrationBand, CalibrationSummary } from "../types";
import {
  calibrationHeadline,
  curveRadius,
  curveScale,
  isOnDiagonal,
  maxBandN,
} from "./calibrationView";

function summary(over: {
  established: boolean;
  beatsBaseline: boolean | null;
  baseline?: number;
  labelText?: string;
}): CalibrationSummary {
  return {
    baseline: over.baseline ?? 0.25,
    headline: {
      meanBrier: 0.2,
      n: 12,
      label: { established: over.established, label: over.labelText ?? "established" },
      beatsBaseline: over.beatsBaseline,
    },
  } as unknown as CalibrationSummary;
}

describe("calibrationView.calibrationHeadline", () => {
  it("leads with the provisional reading and a slate tone when not established", () => {
    const { tone, reading } = calibrationHeadline(
      summary({ established: false, beatsBaseline: true, labelText: "early, 3 resolved" }),
    );
    expect(tone).toBe("var(--slate)");
    expect(reading).toContain("early, 3 resolved");
    expect(reading).toContain("provisional");
  });

  it("reads better-than-chance in teal when established and beating the baseline", () => {
    const { tone, reading } = calibrationHeadline(summary({ established: true, beatsBaseline: true }));
    expect(tone).toBe("var(--teal)");
    expect(reading).toContain("Better than chance");
    expect(reading).toContain("0.25");
  });

  it("reads no-better-than-chance in coral when established but not beating the baseline", () => {
    const { tone, reading } = calibrationHeadline(summary({ established: true, beatsBaseline: false }));
    expect(tone).toBe("var(--coral)");
    expect(reading).toContain("No better than chance");
  });

  it("treats a null beatsBaseline as not-established tone even if established", () => {
    const { tone } = calibrationHeadline(summary({ established: true, beatsBaseline: null }));
    expect(tone).toBe("var(--slate)");
  });
});

describe("calibrationView curve geometry", () => {
  const bands: CalibrationBand[] = [
    { lower: 0, upper: 0.25, n: 2, avgProbability: 0.1, observedFrequency: 0.1 },
    { lower: 0.25, upper: 0.5, n: 8, avgProbability: 0.4, observedFrequency: 0.6 },
  ];

  it("floors the largest band count at 1 so dot scaling never divides by zero", () => {
    expect(maxBandN(bands)).toBe(8);
    expect(maxBandN([])).toBe(1);
    expect(maxBandN([{ lower: 0, upper: 1, n: 0, avgProbability: null, observedFrequency: null }])).toBe(1);
  });

  it("maps probability left-to-right and frequency bottom-to-top within the padded box", () => {
    const { inner, x, y } = curveScale(100, 10);
    expect(inner).toBe(80);
    expect(x(0)).toBe(10);
    expect(x(1)).toBe(90);
    expect(y(0)).toBe(90); // 0 frequency sits at the bottom
    expect(y(1)).toBe(10); // 1 frequency sits at the top
  });

  it("scales a dot radius by its share of the largest count", () => {
    expect(curveRadius(0, 8)).toBe(3);
    expect(curveRadius(8, 8)).toBe(9);
  });

  it("flags points within tolerance of the perfect-calibration diagonal", () => {
    expect(isOnDiagonal(0.4, 0.45)).toBe(true);
    expect(isOnDiagonal(0.4, 0.6)).toBe(false);
  });
});
