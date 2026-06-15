import React, { useState } from "react";
import { ChevronDown, ChevronRight, Cpu } from "lucide-react";
import type { Confounder, PipelineRun, SubStage } from "../../types";
import { formatDateTime, formatDuration, formatInt } from "./format";

// The collapsible "How this was reasoned" strip. It shows the real recorded
// pipeline for this tenant layer: each sub-stage's state and per-seat telemetry,
// the genuine Confounder count, and when and by which generator the content was
// produced. Nothing here is animated as if live; it reports what was recorded.

const STAGE_STATUS_COLOR: Record<SubStage["status"], string> = {
  done: "var(--teal)",
  running: "var(--blue)",
  pending: "var(--slate-light)",
  error: "var(--coral)",
  skipped: "var(--slate-light)",
};

function StageRow({ stage }: { stage: SubStage }) {
  const t = stage.telemetry;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid var(--border)",
        alignItems: "baseline",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: STAGE_STATUS_COLOR[stage.status] }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>{stage.name}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--slate)", display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>
        {stage.status === "skipped" ? (
          <span style={{ color: "var(--slate-light)" }}>skipped (express)</span>
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
            {stage.error && <span style={{ color: "var(--coral-ink)" }}>{stage.error}</span>}
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
  const sovereign = stages.some((s) => s.telemetry?.executionMode === "sovereign");

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Cpu size={16} color="var(--navy-soft)" />
          <span className="font-serif" style={{ fontSize: 16, color: "var(--navy)" }}>
            How this was reasoned
          </span>
          {sovereign && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--navy-soft)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              Sovereign mode
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--slate-light)", fontSize: 12 }}>
          <span>
            {stages.length} stages, {confounderCount} confounders
          </span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      {open && (
        <div style={{ padding: "4px 20px 20px", borderTop: "1px solid var(--border)" }}>
          {stages.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--slate)", padding: "12px 0" }}>
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
            <div style={{ marginTop: 14, fontSize: 12, color: "var(--navy-soft)", display: "flex", flexWrap: "wrap", gap: "2px 16px" }}>
              <span style={{ fontWeight: 600 }}>Reasoned in sovereign mode</span>
              <span>External grounding unavailable</span>
            </div>
          )}
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--slate-light)", display: "flex", flexWrap: "wrap", gap: "2px 16px" }}>
            {generatorModel && <span>Generator: {generatorModel}</span>}
            {generatedAt && <span>Generated: {formatDateTime(generatedAt)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
