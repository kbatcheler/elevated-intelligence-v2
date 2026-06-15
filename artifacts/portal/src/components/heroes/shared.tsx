import React from "react";
import type { HeroPanel, Tone } from "../../types";
import { Sparkline, Eyebrow } from "../primitives";
import { heroToneVar, heroToneInkVar } from "./types";

// Shared, presentational hero pieces. Every archetype hero composes these over
// real persisted fields. None of them compute or invent a figure: they only
// place and emphasize values that already exist on the layer detail.

type Accent = "navy" | "teal" | "amber" | "coral" | "gold";

export function HeroCard({ accent = "navy", children }: { accent?: Accent; children: React.ReactNode }) {
  return (
    <div className={`card card-accent-${accent}`} style={{ padding: 24 }}>
      {children}
    </div>
  );
}

export function HeroHead({ archetype, name }: { archetype: string; name: string }) {
  return (
    <>
      <Eyebrow>{archetype}</Eyebrow>
      <h1
        className="font-serif"
        style={{ fontSize: 30, fontWeight: 700, color: "var(--navy)", margin: "8px 0 0", lineHeight: 1.15 }}
      >
        {name}
      </h1>
    </>
  );
}

export function HeroBigMetric({
  label,
  value,
  sub,
  tone,
  align = "left",
}: {
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
  align?: "left" | "right";
}) {
  return (
    <div style={{ minWidth: 0, textAlign: align }}>
      <div className="eyebrow" style={{ color: "var(--slate-light)" }}>
        {label}
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 34, fontWeight: 500, color: `var(--${heroToneVar(tone)})`, lineHeight: 1.1 }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 13, color: "var(--slate)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function HeroTopRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 18,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export function HeroRead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16, fontSize: 15, color: "var(--slate)", lineHeight: 1.5, maxWidth: 720 }}>{children}</div>
  );
}

// The hero sparkline. Caps at the last twelve points per the hero constraint and
// degrades to nothing when fewer than two points exist (Sparkline returns null).
export function HeroTrend({ panel, width = 168, height = 46 }: { panel: HeroPanel; width?: number; height?: number }) {
  return <Sparkline points={panel.trend.slice(-12)} tone={panel.tone} width={width} height={height} />;
}

// A small labelled statistic, the building block of scorecard, cohort, aging and
// financial morphs. Value and label are real strings off the layer content.
export function MiniStat({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div
      style={{
        flex: "1 1 130px",
        minWidth: 120,
        border: "1px solid var(--cream-dark)",
        borderRadius: 10,
        padding: "10px 12px",
        background: "var(--paper)",
      }}
    >
      <div className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10 }}>
        {label}
      </div>
      <div className="font-mono" style={{ fontSize: 19, fontWeight: 500, color: `var(--${heroToneInkVar(tone)})`, lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// A tone chip: label plus value rendered in the tone color. Used by the
// distribution and sentiment morph to show the spread of signal tones.
export function ToneChip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const v = heroToneVar(tone);
  const ink = heroToneInkVar(tone);
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 2,
        padding: "8px 12px",
        borderRadius: 999,
        background: `var(--${v}-faint, var(--cream-dark))`,
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 11, color: "var(--slate)", whiteSpace: "nowrap" }}>{label}</span>
      <span className="font-mono" style={{ fontSize: 15, fontWeight: 600, color: `var(--${ink})` }}>
        {value}
      </span>
    </div>
  );
}

// A horizontal connector glyph between flow or bridge steps. Pure decoration, no
// data attached.
export function FlowArrow() {
  return (
    <span aria-hidden style={{ color: "var(--slate-light)", fontSize: 18, lineHeight: 1, alignSelf: "center" }}>
      &rarr;
    </span>
  );
}
