import React from "react";
import type { HeroPanel, Tone } from "../../types";
import { Sparkline, Eyebrow } from "../primitives";

// Shared, presentational hero pieces. Every archetype hero composes these over
// real persisted fields. None of them compute or invent a figure: they only
// place and emphasize values that already exist on the layer detail.

type Accent = "navy" | "teal" | "amber" | "coral" | "gold";

// Tone to full Tailwind class strings, kept as static maps (not dynamic
// `text-${x}` interpolation) so the utilities survive the build. These mirror
// heroToneVar/heroToneInkVar exactly: the strong variant carries large display
// figures and accent rules, the ink variant carries normal-sized coloured text.
const heroToneStrongText: Record<Tone, string> = {
  good: "text-teal",
  warn: "text-amber-base",
  bad: "text-coral",
  neutral: "text-navy",
};

export const heroToneInkText: Record<Tone, string> = {
  good: "text-teal-ink",
  warn: "text-amber-ink",
  bad: "text-coral-ink",
  neutral: "text-navy",
};

const heroToneFaintBg: Record<Tone, string> = {
  good: "bg-teal-faint",
  warn: "bg-amber-faint",
  bad: "bg-coral-faint",
  neutral: "bg-cream-dark",
};

export const heroToneTopBorder: Record<Tone, string> = {
  good: "border-teal",
  warn: "border-amber-base",
  bad: "border-coral",
  neutral: "border-navy",
};

export function HeroCard({ accent = "navy", children }: { accent?: Accent; children: React.ReactNode }) {
  return (
    <div className={`card card-accent-${accent} p-6`}>
      {children}
    </div>
  );
}

export function HeroHead({ archetype, name }: { archetype: string; name: string }) {
  return (
    <>
      <Eyebrow>{archetype}</Eyebrow>
      <h1 className="font-serif text-[30px] font-bold text-navy mt-2 leading-[1.15]">
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
  const alignClass: Record<"left" | "right", string> = { left: "text-left", right: "text-right" };
  return (
    <div className={`min-w-0 ${alignClass[align]}`}>
      <div className="eyebrow text-slate-light">{label}</div>
      <div className={`font-mono text-[34px] font-medium leading-[1.1] ${heroToneStrongText[tone]}`}>
        {value}
      </div>
      {sub && <div className="text-caption text-slate-base mt-1">{sub}</div>}
    </div>
  );
}

export function HeroTopRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[18px] flex items-end justify-between gap-5 flex-wrap">
      {children}
    </div>
  );
}

export function HeroRead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 text-body text-slate-base leading-normal max-w-[720px]">{children}</div>
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
    <div className="flex-[1_1_130px] min-w-[120px] border border-cream-dark rounded-[10px] py-2.5 px-3 bg-paper">
      <div className="eyebrow text-slate-light text-[10px]">{label}</div>
      <div className={`font-mono text-[19px] font-medium leading-[1.2] ${heroToneInkText[tone]}`}>
        {value}
      </div>
      {sub && <div className="text-meta text-slate-base mt-0.5">{sub}</div>}
    </div>
  );
}

// A tone chip: label plus value rendered in the tone color. Used by the
// distribution and sentiment morph to show the spread of signal tones.
export function ToneChip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className={`inline-flex flex-col gap-0.5 py-2 px-3 rounded-full min-w-0 ${heroToneFaintBg[tone]}`}>
      <span className="text-meta text-slate-base whitespace-nowrap">{label}</span>
      <span className={`font-mono text-body font-semibold ${heroToneInkText[tone]}`}>
        {value}
      </span>
    </div>
  );
}

// A horizontal connector glyph between flow or bridge steps. Pure decoration, no
// data attached.
export function FlowArrow() {
  return (
    <span aria-hidden className="text-slate-light text-[18px] leading-none self-center">
      &rarr;
    </span>
  );
}
