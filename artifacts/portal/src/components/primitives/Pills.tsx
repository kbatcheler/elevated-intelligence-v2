import React from "react";
import type { Basis, ConfounderVerdict } from "../../types";
import { basisLabel, basisPillClass, pct } from "./format";

type PillColor = "navy" | "teal" | "amber" | "coral" | "blue" | "purple" | "gray" | "red";

export function Pill({ color, children }: { color: PillColor; children: React.ReactNode }) {
  return <span className={`pill pill-${color}`}>{children}</span>;
}

// A figure's provenance: verified from a source signal, or modelled by the
// cortex. Every displayed figure declares one.
export function ProvenancePill({ basis }: { basis: Basis }) {
  return <span className={`pill ${basisPillClass(basis)}`}>{basisLabel(basis)}</span>;
}

// Provenance plus the numeric confidence in a single pill, the densest honest
// statement of how much to trust a figure.
export function ConfidencePill({ basis, confidence }: { basis: Basis; confidence: number }) {
  return (
    <span className={`pill ${basisPillClass(basis)}`}>
      {basisLabel(basis)} {pct(confidence)}
    </span>
  );
}

const VERDICT: Record<ConfounderVerdict, { color: PillColor; label: string }> = {
  ruled_out: { color: "teal", label: "Ruled out" },
  partial: { color: "amber", label: "Partial" },
  unresolved: { color: "coral", label: "Unresolved" },
};

export function VerdictPill({ verdict }: { verdict: ConfounderVerdict }) {
  const v = VERDICT[verdict] ?? { color: "gray" as PillColor, label: verdict };
  return <Pill color={v.color}>{v.label}</Pill>;
}

type TagKind = "data" | "integ" | "model" | "workflow" | "signal";

export function Tag({ kind, children }: { kind: TagKind; children: React.ReactNode }) {
  return <span className={`tag tag-${kind}`}>{children}</span>;
}
