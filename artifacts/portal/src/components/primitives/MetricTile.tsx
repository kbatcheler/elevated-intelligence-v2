import React from "react";
import type { Basis, Tone } from "../../types";
import { ConfidencePill } from "./Pills";

// A single metric: an eyebrow label, the value in mono at its tone colour, an
// optional sub-line, and the provenance + confidence the cortex assigned it.

// The tone maps to a named ink utility so the colour routes through the token
// scale, not an inline style. It mirrors toneInkVar in format.ts.
const TONE_INK: Record<Tone, string> = {
  good: "text-teal-ink",
  warn: "text-amber-ink",
  bad: "text-coral-ink",
  neutral: "text-navy",
};

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
    <div className="surface flex flex-col gap-2 p-4 min-w-0">
      <div className="eyebrow text-slate-light">{label}</div>
      <div className={`font-mono text-[22px] font-medium leading-[1.1] break-words ${TONE_INK[tone]}`}>
        {value}
      </div>
      {sub && <div className="text-caption text-slate-base leading-snug">{sub}</div>}
      {basis && confidence != null && (
        <div>
          <ConfidencePill basis={basis} confidence={confidence} />
        </div>
      )}
    </div>
  );
}
