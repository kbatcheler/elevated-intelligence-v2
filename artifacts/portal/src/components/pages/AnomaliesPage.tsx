import React, { useEffect, useState } from "react";
import { ArrowRight, AlertTriangle, HelpCircle, TrendingDown, Crosshair } from "lucide-react";
import type { PipelineRun, SignalLayer } from "../../types";
import { fetchRuns, fetchSignals } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { deriveAnomalies, type Anomaly, type AnomalyKind } from "../../lib/anomalies";
import { Link } from "../../lib/router";
import { EmptyState, ErrorState, PageHeader, PageWidth, SkeletonLines, pct } from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; signals: SignalLayer[]; runs: PipelineRun[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

const KIND_META: Record<AnomalyKind, { label: string; pill: string; color: string; Icon: typeof AlertTriangle }> = {
  "errored-run": { label: "Failed run", pill: "pill-red", color: "var(--red)", Icon: AlertTriangle },
  "unresolved-confounder": { label: "Open question", pill: "pill-coral", color: "var(--coral-ink)", Icon: HelpCircle },
  "low-confidence-action": { label: "Low-confidence move", pill: "pill-amber", color: "var(--amber-ink)", Icon: TrendingDown },
  "open-gap": { label: "Blind spot", pill: "pill-blue", color: "var(--blue)", Icon: Crosshair },
};

// The figure behind a row, formatted from its real persisted value. Confidence
// is a percentage; an open gap's lift is the confidence points closing it would
// recover. Errored runs and confounders carry no single number, so they show
// none rather than a fabricated one.
function metricText(a: Anomaly): string | null {
  if (a.metric == null) return null;
  if (a.metricLabel === "confidence") return `${pct(a.metric)} confidence`;
  if (a.metricLabel === "confidence lift") return `+${a.metric} pp if closed`;
  return String(a.metric);
}

// The anomaly inbox. Every row is derived from real signals (a failed run, a
// confounder the analysis could not rule out, a modelled action below the
// selection threshold, or a known gap ranked by its real confidence lift) and
// links straight to the layer, so a diagnosis is always one hop away.
export function AnomaliesPage() {
  const { logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    Promise.all([fetchSignals(currentId), fetchRuns(currentId)]).then(([sigOut, runsOut]) => {
      if (!alive) return;
      if ("unauthorized" in sigOut || "unauthorized" in runsOut) return void logout();
      if (sigOut.state === "error" || runsOut.state === "error") return setState({ kind: "error" });
      if (sigOut.state === "empty") return setState({ kind: "empty" });
      setState({ kind: "ready", signals: sigOut.items, runs: runsOut.items });
    });
    return () => {
      alive = false;
    };
  }, [currentId, tenantStatus, logout]);

  const anomalies = state.kind === "ready" ? deriveAnomalies(state.signals, state.runs) : [];

  return (
    <PageWidth space="page">
      <PageHeader
        eyebrow="Anomaly inbox"
        title="What needs a second look"
        subtitle={current ? `Open items across ${current.name}'s intelligence, most urgent first.` : undefined}
      />
      <div className="mt-7">
        {state.kind === "loading" && <SkeletonLines lines={5} />}
        {state.kind === "error" && (
          <ErrorState message="The anomaly inbox could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its anomalies will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState title="No intelligence generated yet" message="Once the pipeline runs, anything needing attention will surface here." />
        )}
        {state.kind === "ready" && anomalies.length === 0 && (
          <EmptyState
            title="Nothing flagged"
            message="No failed runs, every confounder ruled out, no modelled move below the bar, and no open gaps with recoverable confidence."
          />
        )}
        {state.kind === "ready" && anomalies.length > 0 && (
          <div className="grid gap-2.5">
            {anomalies.map((a, i) => (
              <AnomalyRow key={`${a.kind}-${a.layerKey}-${i}`} anomaly={a} />
            ))}
          </div>
        )}
      </div>
    </PageWidth>
  );
}

function AnomalyRow({ anomaly }: { anomaly: Anomaly }) {
  const meta = KIND_META[anomaly.kind];
  const metric = metricText(anomaly);
  const Icon = meta.Icon;
  return (
    <Link to={`/layers/${anomaly.layerKey}`} className="no-underline">
      <div className="card flex gap-3.5 items-start py-4 px-[18px]">
        <Icon size={18} color={meta.color} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`pill ${meta.pill}`}>{meta.label}</span>
            <span className="eyebrow text-slate-light">{anomaly.layerName}</span>
            {metric && (
              <span className="font-mono text-xs text-slate-base ml-auto">
                {metric}
              </span>
            )}
          </div>
          <div className="font-serif text-[16px] text-navy mt-1.5">
            {anomaly.title}
          </div>
          <div className="text-[13.5px] text-slate-base leading-normal mt-0.5">{anomaly.detail}</div>
        </div>
        <ArrowRight size={16} color="var(--gold)" className="shrink-0 mt-0.5" />
      </div>
    </Link>
  );
}
