import React, { useCallback, useEffect, useRef, useState } from "react";
import type { OutcomeLoop, OutcomeLoopEntry } from "../../types";
import { fetchOutcomeLoop } from "../../lib/outcomeLoopApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { Link } from "../../lib/router";
import { basisOf } from "../../lib/decisionView";
import {
  ConfidencePill,
  EmptyState,
  ErrorState,
  MetricTile,
  PageHeader,
  PageWidth,
  Pill,
  ProvenancePill,
  SkeletonLines,
  formatBrier,
  formatDateTime,
  formatUsd,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; loop: OutcomeLoop }
  | { kind: "no-tenant" }
  | { kind: "error" };

const MEAS: Record<string, { color: "teal" | "blue" | "coral" | "gray"; label: string }> = {
  realized: { color: "teal", label: "Realised" },
  on_track: { color: "blue", label: "On track" },
  missed: { color: "coral", label: "Missed" },
  pending: { color: "gray", label: "Pending" },
};

// The outcome-loop closure surface (Phase AQ). Every COMMIT decision read as a
// single chain: the recommendation the board acted on, the action it created, the
// forecast that prediction bound, and the measurement and Brier-scored
// resolution that graded it. Every figure is read from persisted state; a stage
// that has not happened yet renders as a dash, never a fabricated zero. The four
// honest data states (loading, no tenant, empty record, error) are distinct.
export function OutcomeLoopPage() {
  const { logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!currentId) return;
    const out = await fetchOutcomeLoop(currentId);
    if (!mounted.current) return;
    if ("unauthorized" in out) return void logout();
    setState(out.state === "ready" ? { kind: "ready", loop: out.data } : { kind: "error" });
  }, [currentId, logout]);

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    setState({ kind: "loading" });
    void load();
  }, [currentId, tenantStatus, load]);

  return (
    <PageWidth space="page">
      <PageHeader
        eyebrow="Outcome loop"
        title="Closed-loop track record"
        subtitle={
          current
            ? `Every committed decision for ${current.name} read end to end: the recommendation acted on, the forecast it bound, and the measured or modelled resolution that graded it.`
            : undefined
        }
      />
      <div className="mt-7">
        {state.kind === "loading" && <SkeletonLines lines={5} />}
        {state.kind === "error" && (
          <ErrorState message="The outcome loop could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organisation, its outcome loop will appear here."
          />
        )}
        {state.kind === "ready" && state.loop.loops.length === 0 && (
          <EmptyState
            title="No loops to close yet"
            message="Commit a recommended action from a layer to open a loop. Once its forecast resolves, the graded outcome appears here."
          />
        )}
        {state.kind === "ready" && state.loop.loops.length > 0 && (
          <div className="grid gap-4">
            <SummaryPanel loop={state.loop} />
            <div className="grid gap-3">
              {state.loop.loops.map((e) => (
                <LoopCard key={e.decisionId} entry={e} />
              ))}
            </div>
          </div>
        )}
      </div>
    </PageWidth>
  );
}

// The headline read of the whole loop: how many committed decisions, how many
// have closed against a resolved forecast, and the mean Brier across those that
// resolved. The mean is a dash, never a zero, until at least one has resolved.
function SummaryPanel({ loop }: { loop: OutcomeLoop }) {
  const { summary } = loop;
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
      <MetricTile label="Loops" value={String(summary.total)} sub="committed decisions" />
      <MetricTile label="Closed" value={String(summary.closed)} sub="forecast resolved" tone="good" />
      <MetricTile label="Open" value={String(summary.open)} sub="awaiting resolution" />
      <MetricTile label="Mean Brier" value={formatBrier(summary.brierMean)} sub="across closed loops" />
    </div>
  );
}

// One closed (or still-open) loop, top to bottom: the recommendation as it stood
// when committed, then the forecast it bound, then the graded resolution. Every
// missing stage renders as a dash.
function LoopCard({ entry }: { entry: OutcomeLoopEntry }) {
  const { recommendation: rec } = entry;
  return (
    <div className="card grid gap-2.5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-serif text-lead text-navy">{rec.title}</span>
        <Pill color={entry.state === "resolved" ? "teal" : "gray"}>
          {entry.state === "resolved" ? "Loop closed" : "Loop open"}
        </Pill>
      </div>

      {rec.detail && <div className="text-[14px] text-slate-base leading-normal">{rec.detail}</div>}

      <div className="flex gap-3.5 flex-wrap items-center text-xs text-slate-light">
        <Link to={`/layers/${entry.layerKey}`} className="text-blue-base no-underline">
          {entry.layerKey}
        </Link>
        <span>
          Advice at the time: <ConfidencePill basis={basisOf(rec.basis)} confidence={rec.confidence} />
        </span>
        <span>Predicted value: {rec.predictedValueUsd !== null ? formatUsd(rec.predictedValueUsd) : "-"}</span>
        <span>{entry.decidedByEmail ?? "A removed user"}</span>
        <span>{formatDateTime(entry.decidedAt)}</span>
        {rec.provenanceContentHash && <span className="font-mono">{rec.provenanceContentHash.slice(0, 12)}</span>}
        <Pill color={rec.verified ? "teal" : "gray"}>{rec.verified ? "Recommendation verified" : "Operator entered"}</Pill>
        <span title="Provenance refs the recommendation rested on at decision time">
          Evidence:{" "}
          {rec.evidenceRefs.length === 0
            ? "none on record"
            : `${rec.evidenceRefs.length} ref${rec.evidenceRefs.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {entry.rationale && (
        <div className="text-caption text-slate-base leading-normal">
          <span className="eyebrow text-slate-light text-[10px] mr-2">Rationale</span>
          {entry.rationale}
        </div>
      )}

      <ForecastRow entry={entry} />
      <ResolutionRow entry={entry} />
    </div>
  );
}

// The forecast the commit bound, with its probability and (once it resolves) its
// outcome and Brier score. An unresolved forecast is honestly marked; a commit
// that bound none shows the absence rather than a fabricated figure.
function ForecastRow({ entry }: { entry: OutcomeLoopEntry }) {
  const f = entry.forecast;
  return (
    <div className="flex gap-3.5 flex-wrap items-center text-xs text-slate-light border-t border-cream-dark pt-2">
      {entry.action && <span>Action: {entry.action.status.replace(/_/g, " ")}</span>}
      {f ? (
        <span>
          Forecast: {f.probability !== null ? `${Math.round(f.probability * 100)}%` : "-"}
          {f.resolved
            ? ` -> ${f.outcome === 1 ? "occurred" : f.outcome === 0 ? "did not occur" : "resolved"}`
            : " (unresolved)"}
          {f.brierScore !== null ? `, Brier ${f.brierScore.toFixed(3)}` : ""}
          {f.resolutionBasis ? `, resolved by ${f.resolutionBasis}` : ""}
        </span>
      ) : (
        <span>Forecast: none bound</span>
      )}
    </div>
  );
}

// The graded resolution: the latest measurement against the committed action,
// with its honesty basis (measured fact vs modelled estimate), the realised
// value and the variance against the prediction. An unmeasured action shows a
// dash, never a zero.
function ResolutionRow({ entry }: { entry: OutcomeLoopEntry }) {
  const m = entry.measurement;
  const meas = m ? (MEAS[m.status] ?? { color: "gray" as const, label: m.status }) : null;
  return (
    <div className="flex gap-3.5 flex-wrap items-center text-xs text-slate-light border-t border-cream-dark pt-2">
      {m && meas ? (
        <>
          <Pill color={meas.color}>{meas.label}</Pill>
          <ProvenancePill basis={m.basis === "measured" ? "verified" : "modelled"} />
          <span>Realised: {m.realizedValueUsd !== null ? formatUsd(m.realizedValueUsd) : "-"}</span>
          <span>Variance: {m.varianceVsPrediction !== null ? formatUsd(m.varianceVsPrediction) : "-"}</span>
          <span>{formatDateTime(m.measuredAt)}</span>
        </>
      ) : (
        <span>Resolution: not yet measured</span>
      )}
    </div>
  );
}
