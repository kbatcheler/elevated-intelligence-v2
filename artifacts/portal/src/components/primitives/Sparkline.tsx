import React from "react";
import type { TrendPoint, Tone } from "../../types";
import { toneColorVar } from "./format";

// A decorative trend line built by hand in SVG, no charting dependency. It
// renders only the real trend points the hero stage produced (capped at 12 by
// the cortex). With fewer than two points there is nothing to draw, so it
// renders nothing rather than inventing a shape.
export function Sparkline({
  points,
  tone = "neutral",
  width = 132,
  height = 36,
}: {
  points: TrendPoint[];
  tone?: Tone;
  width?: number;
  height?: number;
}) {
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const coords = values.map((v, i) => {
    const x = pad + (innerW * i) / (values.length - 1);
    // Higher values sit higher on the canvas.
    const y = pad + innerH * (1 - (v - min) / span);
    return [x, y] as const;
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const color = toneColorVar[tone];
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Trend"
      style={{ display: "block", overflow: "visible" }}
    >
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
