import React from "react";
import type { Tone } from "../../types";
import type {
  AssessmentResult,
  ReportDimension,
  ReportGapLayer,
  ReportSystem,
  ScoreBand,
} from "../../lib/assessmentApi";
import { toneColorVar } from "../primitives/format";
import { SerifDiagnosis } from "../primitives";

// Shared render pieces for the Intelligence Gap Assessment, used by both the free
// on-screen result and the forwardable report so the two surfaces never drift.
// Every figure shown here is derived from the prospect's own answers or the
// canonical layer registry; nothing is fabricated.

// A weak band reads in the alert palette and a strong one in the confident
// palette, so a sharp operation is congratulated rather than alarmed.
export const BAND_TONE: Record<ScoreBand, Tone> = {
  blind: "bad",
  reactive: "warn",
  ahead: "good",
};
const BAND_DIAGNOSIS: Record<Tone, "teal" | "amber" | "coral" | "navy"> = {
  good: "teal",
  warn: "amber",
  bad: "coral",
  neutral: "navy",
};
const BAND_LABEL: Record<ScoreBand, string> = {
  blind: "Flying blind",
  reactive: "Reacting late",
  ahead: "Ahead of it",
};

export function OverallHero({ result }: { result: AssessmentResult }) {
  const tone = BAND_TONE[result.overall.band];
  return (
    <div className="surface surface-cream p-6 md:p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <SerifDiagnosis
          eyebrow="Your intelligence gap"
          tone={BAND_DIAGNOSIS[tone]}
          lead
          support={result.gap.paragraphs[0] || undefined}
        >
          {result.gap.headline}
        </SerifDiagnosis>
        <div className="md:text-right">
          <span
            className="font-mono text-display font-medium leading-none break-words"
            style={{ color: toneColorVar[tone] }}
          >
            {result.overall.score}
          </span>
          <div className="eyebrow text-slate-light mt-2">
            Readiness, out of 100 ({BAND_LABEL[result.overall.band]})
          </div>
        </div>
      </div>
    </div>
  );
}

function DimensionBar({ dimension }: { dimension: ReportDimension }) {
  const tone = BAND_TONE[dimension.band];
  const width = Math.max(0, Math.min(100, dimension.score));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-navy">{dimension.label}</div>
          <div className="eyebrow text-slate-light mt-0.5">{dimension.blurb}</div>
        </div>
        <div
          className="font-mono text-[15px] font-medium shrink-0"
          style={{ color: toneColorVar[tone] }}
        >
          {dimension.score}
        </div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-cream-dark overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: width + "%", backgroundColor: toneColorVar[tone] }}
        />
      </div>
    </div>
  );
}

export function DimensionScores({ dimensions }: { dimensions: ReportDimension[] }) {
  return (
    <section className="card p-6">
      <h2 className="font-serif text-title font-bold text-navy m-0 mb-4">
        How you scored, by dimension
      </h2>
      <div className="grid gap-4">
        {dimensions.map((d) => (
          <DimensionBar key={d.key} dimension={d} />
        ))}
      </div>
    </section>
  );
}

export function GapNarrative({ result }: { result: AssessmentResult }) {
  if (result.gap.paragraphs.length <= 1) return null;
  return (
    <section className="card p-6">
      <div className="grid gap-3">
        {result.gap.paragraphs.slice(1).map((p, i) => (
          <p key={i} className="text-[14px] text-slate-base leading-relaxed m-0">
            {p}
          </p>
        ))}
      </div>
    </section>
  );
}

function GapLayerCard({ layer }: { layer: ReportGapLayer }) {
  return (
    <div className="border-l-[3px] border-teal pl-3.5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[15px] font-semibold text-navy">{layer.layerName}</div>
        <div className="eyebrow text-slate-light">{layer.moduleGroup}</div>
      </div>
      <p className="text-[13.5px] text-slate-base leading-relaxed mt-1.5 mb-0">{layer.reason}</p>
      <div className="text-[13.5px] text-navy mt-1.5">
        <span className="eyebrow text-slate-light">Closed by </span>
        {layer.closes}
      </div>
    </div>
  );
}

export function GapLayers({ layers }: { layers: ReportGapLayer[] }) {
  if (layers.length === 0) return null;
  return (
    <section className="card card-accent-teal p-6">
      <div className="eyebrow text-slate-light mb-1">Where the gap lives in your business</div>
      <h2 className="font-serif text-title font-bold text-navy m-0 mb-4">
        The layers that would close it
      </h2>
      <div className="grid gap-4">
        {layers.map((l) => (
          <GapLayerCard key={l.layerKey} layer={l} />
        ))}
      </div>
    </section>
  );
}

export function OneLineTeach({ oneLine }: { oneLine: string }) {
  return (
    <section className="surface surface-cream p-6 md:p-8 text-center">
      <p className="font-serif text-[20px] md:text-[22px] text-navy leading-snug m-0 max-w-[640px] mx-auto">
        {oneLine}
      </p>
    </section>
  );
}

export function CostFraming({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="card card-accent-amber p-6">
      <div className="eyebrow text-slate-light mb-1">What the gap costs</div>
      <div className="grid gap-2.5 mt-2">
        {lines.map((line, i) => (
          <p key={i} className="text-[14px] text-slate-base leading-relaxed m-0">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}

export function SystemsRow({ systems }: { systems: ReportSystem[] }) {
  if (systems.length === 0) return null;
  return (
    <section className="card p-5">
      <div className="eyebrow text-slate-light mb-2">The systems you already run</div>
      <div className="flex gap-2 flex-wrap">
        {systems.map((s) => (
          <span key={s.key} className="tag tag-data">
            {s.label}
          </span>
        ))}
      </div>
      <p className="text-[13px] text-slate-base leading-relaxed mt-3 mb-0">
        Elevated Intelligence reads what these systems already hold. The gap is not more data, it is
        what the data means.
      </p>
    </section>
  );
}

// The full free result, shared by the flow and the forwardable report.
export function ResultBody({ result }: { result: AssessmentResult }) {
  return (
    <div className="grid gap-4">
      <OverallHero result={result} />
      <DimensionScores dimensions={result.dimensions} />
      <GapNarrative result={result} />
      <GapLayers layers={result.gapToLayers} />
      <OneLineTeach oneLine={result.oneLine} />
      <CostFraming lines={result.cost.lines} />
      <SystemsRow systems={result.systems} />
    </div>
  );
}
