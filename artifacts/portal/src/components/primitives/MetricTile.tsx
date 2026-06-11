import React from "react";
import type { Basis, Tone } from "../../types";
import { toneColorVar } from "./format";
import { ConfidencePill } from "./Pills";

// A single metric: an eyebrow label, the value in mono at its tone color, an
// optional sub-line, and the provenance + confidence the cortex assigned it.
export function MetricTile({
  label,
  value,
  sub,
  tone = "neutral",
  confidence,
  basis,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  confidence?: number;
  basis?: Basis;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: 16,
        background: "var(--paper)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div className="eyebrow" style={{ color: "var(--slate-light)" }}>
        {label}
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 22, fontWeight: 500, color: toneColorVar[tone], lineHeight: 1.1, wordBreak: "break-word" }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.4 }}>{sub}</div>
      )}
      {basis && confidence != null && (
        <div>
          <ConfidencePill basis={basis} confidence={confidence} />
        </div>
      )}
    </div>
  );
}
