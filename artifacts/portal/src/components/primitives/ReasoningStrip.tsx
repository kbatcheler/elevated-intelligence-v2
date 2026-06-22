import React, { useState } from "react";
import { ChevronDown, ChevronRight, Cpu } from "lucide-react";
import type { Confounder, PipelineRun, SubStage } from "../../types";
import { formatDateTime, formatDuration, formatInt } from "./format";
import { isSovereignRun } from "../../lib/reasoningTelemetry";

// The collapsible "How this was reasoned" strip. It shows the real recorded
// pipeline for this tenant layer: each sub-stage's state and per-seat telemetry,
// the genuine Confounder count, and when and by which generator the content was
// produced. Nothing here is animated as if live; it reports what was recorded.

// The status-dot colour as a token utility, mirroring STAGE_STATUS_COLOR in
// reasoningTelemetry so the dot routes through the colour scale, not an inline.
const STATUS_DOT: Record<SubStage["status"], string> = {
  done: "bg-teal",
  running: "bg-blue-base",
  pending: "bg-slate-light",
  error: "bg-coral",
  skipped: "bg-slate-light",
};

function StageRow({ stage }: { stage: SubStage }) {
  const t = stage.telemetry;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 items-baseline border-b border-border-base">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[stage.status]}`} />
        <span className="text-caption font-semibold text-navy">{stage.name}</span>
      </div>
      <div className="text-xs text-slate-base flex flex-wrap gap-x-3.5 gap-y-0.5">
        {stage.status === "skipped" ? (
          <span className="text-slate-light">skipped (express)</span>
        ) : (
          <>
            <span className="font-mono">{formatDuration(stage.durationMs)}</span>
            {t?.seat && <span>seat: {t.seat}</span>}
            {t?.model && <span>model: {t.model}</span>}
            {(t?.inputTokens != null || t?.outputTokens != null) && (
              <span className="font-mono">
                tok: {formatInt(t?.inputTokens)} in / {formatInt(t?.outputTokens)} out
              </span>
            )}
            {t?.searchCalls != null && t.searchCalls > 0 && (
              <span className="font-mono">search: {formatInt(t.searchCalls)}</span>
            )}
            {stage.error && <span className="text-coral-ink">{stage.error}</span>}
          </>
        )}
      </div>
    </div>
  );
}

export function ReasoningStrip({
  run,
  confounders,
  generatorModel,
  generatedAt,
}: {
  run: PipelineRun | null;
  confounders?: Confounder[] | null;
  generatorModel?: string;
  generatedAt?: string;
}) {
  const [open, setOpen] = useState(false);
  const stages = run?.subStages ?? [];
  const confounderCount = confounders?.length ?? 0;
  // Sovereign honesty marker: surfaced ONLY when the run actually recorded it on a
  // sub-stage. In sovereign mode every stage ran in-boundary on the local seat
  // with no external provider, so there was no external grounding or web-search
  // verification channel. This is read straight off the recorded telemetry, never
  // inferred; an outside_in or connected run records no marker and the strip is
  // unchanged for it.
  const sovereign = isSovereignRun(stages);

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 bg-transparent border-none cursor-pointer text-left"
      >
        <span className="flex items-center gap-2.5">
          <Cpu size={16} color="var(--navy-soft)" />
          <span className="font-serif text-[16px] text-navy">How this was reasoned</span>
          {sovereign && (
            <span className="text-meta font-semibold text-navy-soft border border-border-base rounded-full px-2 py-0.5">
              Sovereign mode
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-slate-light text-xs">
          <span>
            {stages.length} stages, {confounderCount} confounders
          </span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      {open && (
        <div className="px-5 pt-1 pb-5 border-t border-border-base">
          {stages.length === 0 ? (
            <div className="text-caption text-slate-base py-3">
              No recorded pipeline run for this layer yet.
            </div>
          ) : (
            <div>
              {stages.map((s, i) => (
                <StageRow key={i} stage={s} />
              ))}
            </div>
          )}
          {sovereign && (
            <div className="mt-3.5 text-xs text-navy-soft flex flex-wrap gap-x-4 gap-y-0.5">
              <span className="font-semibold">Reasoned in sovereign mode</span>
              <span>External grounding unavailable</span>
            </div>
          )}
          <div className="mt-3.5 text-xs text-slate-light flex flex-wrap gap-x-4 gap-y-0.5">
            {generatorModel && <span>Generator: {generatorModel}</span>}
            {generatedAt && <span>Generated: {formatDateTime(generatedAt)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
