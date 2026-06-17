import type { CalibrationBand, CalibrationSummary } from "../types";

// Pure view logic for the calibration page (Phase AJ): the headline tone and
// reading, and the reliability-curve geometry. Extracted so the verdict copy and
// the plotting math are unit-testable without rendering the SVG.

// The headline tone color and reading paragraph. Below the established threshold
// the honest "early, n resolved" verdict leads so a lucky handful of resolutions
// never reads as a proven track record.
export function calibrationHeadline(data: CalibrationSummary): { tone: string; reading: string } {
  const { headline, baseline } = data;
  const established = headline.label.established;
  const beats = headline.beatsBaseline;
  const tone =
    !established || beats === null
      ? "var(--slate)"
      : beats
        ? "var(--teal)"
        : "var(--coral)";
  const reading = !established
    ? "Not enough resolved forecasts yet to read a verdict (" +
      headline.label.label +
      "). The score is shown, but treat it as provisional until it is established."
    : beats
      ? "Better than chance. A coin-flip forecaster scores " +
        baseline.toFixed(2) +
        "; lower is better, and the system is beating that line."
      : "No better than chance. A coin-flip forecaster scores " +
        baseline.toFixed(2) +
        "; the system is at or above that line, so its probabilities are not yet earning their confidence.";
  return { tone, reading };
}

// The largest resolved-count across the curve bands, floored at 1 so dot scaling
// never divides by zero.
export function maxBandN(curve: readonly CalibrationBand[]): number {
  return Math.max(...curve.map((b) => b.n), 1);
}

// The SVG coordinate transforms for a square plot of the given size and padding.
// x maps a 0..1 probability left to right; y maps a 0..1 frequency bottom to top.
export function curveScale(
  size: number,
  pad: number,
): { inner: number; x: (v: number) => number; y: (v: number) => number } {
  const inner = size - pad * 2;
  return {
    inner,
    x: (v: number) => pad + v * inner,
    y: (v: number) => pad + (1 - v) * inner,
  };
}

// A band's dot radius, scaled by its share of the largest resolved count.
export function curveRadius(n: number, maxN: number): number {
  return 3 + (n / maxN) * 6;
}

// Whether a band sits on the perfect-calibration diagonal within tolerance.
export function isOnDiagonal(avgProbability: number, observedFrequency: number): boolean {
  return Math.abs(avgProbability - observedFrequency) <= 0.1;
}
