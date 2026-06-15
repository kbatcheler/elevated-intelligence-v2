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
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Anomaly inbox"
        title="What needs a second look"
        subtitle={current ? `Open items across ${current.name}'s intelligence, most urgent first.` : undefined}
      />
      <div style={{ marginTop: 28 }}>
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
          <div style={{ display: "grid", gap: 10 }}>
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
    <Link to={`/layers/${anomaly.layerKey}`} style={{ textDecoration: "none" }}>
      <div className="card" style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 18px" }}>
        <Icon size={18} color={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className={`pill ${meta.pill}`}>{meta.label}</span>
            <span className="eyebrow" style={{ color: "var(--slate-light)" }}>{anomaly.layerName}</span>
            {metric && (
              <span className="font-mono" style={{ fontSize: 12, color: "var(--slate)", marginLeft: "auto" }}>
                {metric}
              </span>
            )}
          </div>
          <div className="font-serif" style={{ fontSize: 16, color: "var(--navy)", marginTop: 6 }}>
            {anomaly.title}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.5, marginTop: 2 }}>{anomaly.detail}</div>
        </div>
        <ArrowRight size={16} color="var(--gold)" style={{ flexShrink: 0, marginTop: 2 }} />
      </div>
    </Link>
  );
}
