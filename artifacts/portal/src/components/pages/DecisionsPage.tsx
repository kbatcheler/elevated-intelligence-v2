import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  DecisionTimeline,
  DecisionTimelineEntry,
  PreMortem,
  PreMortemIndicator,
  PreMortemIndicatorStatus,
} from "../../types";
import { fetchDecisionTimeline, runPreMortem, setIndicatorStatus } from "../../lib/decisionApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { Link } from "../../lib/router";
import { basisOf } from "../../lib/decisionView";
import {
  ConfidencePill,
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  Pill,
  SkeletonLines,
  formatDateTime,
  formatUsd,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; timeline: DecisionTimeline }
  | { kind: "no-tenant" }
  | { kind: "error" };

const DECISION: Record<DecisionTimelineEntry["decision"], { color: "navy" | "amber" | "coral"; label: string }> = {
  commit: { color: "navy", label: "Committed" },
  defer: { color: "amber", label: "Deferred" },
  reject: { color: "coral", label: "Rejected" },
};

const MEAS: Record<string, { color: "teal" | "blue" | "coral" | "gray"; label: string }> = {
  realized: { color: "teal", label: "Realized" },
  on_track: { color: "blue", label: "On track" },
  missed: { color: "coral", label: "Missed" },
  pending: { color: "gray", label: "Pending" },
};

// The board-grade decision audit timeline (Phase AL). Every recorded decision,
// newest first, with the advice exactly as it stood when the call was made, the
// pre-mortems attached, the linked forecast and committed-action outcome, and the
// running realised value. Every figure is read from persisted state; nothing here
// is projected or fabricated. A non-viewer seat can run an on-demand pre-mortem
// against a decision and report the observed state of its early-warning
// indicators; a viewer sees the same audit, read only.
export function DecisionsPage() {
  const { user, logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });
  const mounted = useRef(true);
  const canWrite = user?.role !== "client-viewer";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!currentId) return;
    const out = await fetchDecisionTimeline(currentId);
    if (!mounted.current) return;
    if ("unauthorized" in out) return void logout();
    setState(out.state === "ready" ? { kind: "ready", timeline: out.timeline } : { kind: "error" });
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
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Audit"
        title="Decision ledger"
        subtitle={
          current
            ? `Every commit, defer and reject for ${current.name}, with the advice at the time, the pre-mortems run against it, and the value realised since.`
            : undefined
        }
      />
      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={5} />}
        {state.kind === "error" && (
          <ErrorState message="The decision ledger could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its decision ledger will appear here."
          />
        )}
        {state.kind === "ready" && state.timeline.entries.length === 0 && (
          <EmptyState
            title="No decisions recorded yet"
            message="Commit, defer or reject a recommended action from a layer to start the audit timeline."
          />
        )}
        {state.kind === "ready" && state.timeline.entries.length > 0 && currentId && (
          <div style={{ display: "grid", gap: 16 }}>
            <SummaryPanel timeline={state.timeline} />
            <div style={{ display: "grid", gap: 12 }}>
              {state.timeline.entries.map((e) => (
                <DecisionCard
                  key={e.id}
                  entry={e}
                  tenantId={currentId}
                  canWrite={canWrite}
                  onChanged={load}
                  onUnauthorized={logout}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </PageWidth>
  );
}

// The headline read of the whole ledger: how many decisions of each kind, how the
// contrarian calls have resolved, and the value identified versus realised. Every
// figure is a server-computed count or sum over persisted rows.
function SummaryPanel({ timeline }: { timeline: DecisionTimeline }) {
  const { summary } = timeline;
  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <Figure label="Decisions" value={String(summary.totalDecisions)} sub={`${summary.commits} committed, ${summary.defers} deferred, ${summary.rejects} rejected`} />
        <Figure label="Value identified" value={formatUsd(summary.totalIdentifiedValueUsd)} sub="across committed actions" color="var(--navy)" />
        <Figure label="Value realised" value={formatUsd(summary.totalRealizedValueUsd)} sub="graded outcomes only" color="var(--teal)" />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Pill color="teal">Overruled and right: {summary.overruledRight}</Pill>
        <Pill color="coral">Overruled and wrong: {summary.overruledWrong}</Pill>
        <Pill color="gray">Contrarian, pending: {summary.overruledPending}</Pill>
      </div>
    </div>
  );
}

function Figure({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: "var(--slate-light)" }}>
        {label}
      </div>
      <div className="font-serif" style={{ fontSize: 26, color: color ?? "var(--navy)" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--slate-light)" }}>{sub}</div>
    </div>
  );
}

function DecisionCard({
  entry,
  tenantId,
  canWrite,
  onChanged,
  onUnauthorized,
}: {
  entry: DecisionTimelineEntry;
  tenantId: string;
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
  onUnauthorized: () => void;
}) {
  const d = DECISION[entry.decision];
  const [running, setRunning] = useState(false);
  const [pmError, setPmError] = useState<string | null>(null);

  async function onRunPreMortem() {
    setRunning(true);
    setPmError(null);
    const out = await runPreMortem(tenantId, entry.id);
    setRunning(false);
    if ("unauthorized" in out) return void onUnauthorized();
    if ("error" in out) {
      setPmError("The pre-mortem could not be completed. Try again.");
      return;
    }
    await onChanged();
  }

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="font-serif" style={{ fontSize: 17, color: "var(--navy)" }}>
          {entry.recommendedTitle}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Pill color={d.color}>{d.label}</Pill>
          <OverruledPill entry={entry} />
        </div>
      </div>

      {entry.recommendedDetail && (
        <div style={{ fontSize: 14, color: "var(--slate)", lineHeight: 1.5 }}>{entry.recommendedDetail}</div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--slate-light)" }}>
        <Link to={`/layers/${entry.layerKey}`} style={{ color: "var(--blue)", textDecoration: "none" }}>
          {entry.layerKey}
        </Link>
        <span>
          Advice at the time: <ConfidencePill basis={basisOf(entry.systemBasis)} confidence={entry.systemConfidence} />
        </span>
        {entry.recommendedValueUsd !== null && <span>Predicted value: {formatUsd(entry.recommendedValueUsd)}</span>}
        <span>{entry.decidedByEmail ?? "A removed user"}</span>
        <span>{formatDateTime(entry.decidedAt)}</span>
        {entry.provenanceContentHash && (
          <span className="font-mono">{entry.provenanceContentHash.slice(0, 12)}</span>
        )}
        <Pill color={entry.recommendationVerified ? "teal" : "gray"}>
          {entry.recommendationVerified ? "Recommendation verified" : "Operator entered"}
        </Pill>
        <span title="Provenance refs the recommendation rested on at decision time">
          Evidence:{" "}
          {entry.evidenceRefs.length === 0
            ? "none on record"
            : `${entry.evidenceRefs.length} ref${entry.evidenceRefs.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {entry.rationale && (
        <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>
          <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10, marginRight: 8 }}>
            Rationale
          </span>
          {entry.rationale}
        </div>
      )}

      <OutcomeRow entry={entry} />

      {entry.preMortems.length > 0 && (
        <div style={{ display: "grid", gap: 10, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
          {entry.preMortems.map((pm) => (
            <PreMortemBlock
              key={pm.id}
              preMortem={pm}
              tenantId={tenantId}
              canWrite={canWrite}
              onChanged={onChanged}
              onUnauthorized={onUnauthorized}
            />
          ))}
        </div>
      )}

      {canWrite && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn-ghost" onClick={onRunPreMortem} disabled={running} style={{ fontSize: 12 }}>
            {running
              ? "Running pre-mortem..."
              : entry.preMortems.length > 0
                ? "Re-run pre-mortem"
                : "Run pre-mortem"}
          </button>
          {running && (
            <span style={{ fontSize: 11, color: "var(--slate-light)" }}>
              Routing to the Confounder seat. This makes a live model call and can take a moment.
            </span>
          )}
          {pmError && <span style={{ fontSize: 12.5, color: "var(--coral-ink)" }}>{pmError}</span>}
        </div>
      )}
    </div>
  );
}

// The contrarian verdict. Only a decision that went AGAINST the recommendation
// carries one; a commit followed the advice, so nothing is shown. Until the
// linked forecast resolves the verdict is honestly pending.
function OverruledPill({ entry }: { entry: DecisionTimelineEntry }) {
  if (!entry.contradictsRecommendation || entry.overruledStatus === null) return null;
  if (entry.overruledStatus === "right") return <Pill color="teal">Overruled and right</Pill>;
  if (entry.overruledStatus === "wrong") return <Pill color="coral">Overruled and wrong</Pill>;
  return <Pill color="gray">Contrarian call, pending</Pill>;
}

// The decision's outcome as it stands now: the committed action's lifecycle and
// its latest graded measurement, the linked forecast's resolution, and the
// running realised value across the ledger to this point.
function OutcomeRow({ entry }: { entry: DecisionTimelineEntry }) {
  const meas = entry.measurementStatus ? MEAS[entry.measurementStatus] ?? { color: "gray" as const, label: entry.measurementStatus } : null;
  const hasForecast = entry.forecastId !== null;
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--slate-light)", borderTop: "1px solid var(--cream-dark)", paddingTop: 8 }}>
      {entry.actionStatus && <span>Action: {entry.actionStatus.replace(/_/g, " ")}</span>}
      {entry.realizedValueUsd !== null && <span>Realised: {formatUsd(entry.realizedValueUsd)}</span>}
      {meas && <Pill color={meas.color}>{meas.label}</Pill>}
      {hasForecast && (
        <span>
          Forecast:{" "}
          {entry.forecastProbability !== null ? `${Math.round(entry.forecastProbability * 100)}%` : "-"}
          {entry.forecastResolved
            ? ` -> ${entry.forecastOutcome === 1 ? "occurred" : entry.forecastOutcome === 0 ? "did not occur" : "resolved"}`
            : " (unresolved)"}
          {entry.forecastBrierScore !== null ? `, Brier ${entry.forecastBrierScore.toFixed(3)}` : ""}
        </span>
      )}
      <span>Running realised: {formatUsd(entry.cumulativeRealizedValueUsd)}</span>
    </div>
  );
}

// One pre-mortem attached to the decision: the ranked failure modes the
// Confounder imagined, each with its mechanism and likelihood, and the
// early-warning indicators to watch. A failed pre-mortem shows an honest failure,
// never a fabricated set of modes.
function PreMortemBlock({
  preMortem,
  tenantId,
  canWrite,
  onChanged,
  onUnauthorized,
}: {
  preMortem: PreMortem;
  tenantId: string;
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
  onUnauthorized: () => void;
}) {
  if (preMortem.status === "failed") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill color="coral">Pre-mortem failed</Pill>
          <span style={{ fontSize: 11, color: "var(--slate-light)" }}>{formatDateTime(preMortem.createdAt)}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--coral-ink)", lineHeight: 1.5 }}>
          The pre-mortem did not complete{preMortem.error ? ` (${preMortem.error})` : ""}. No failure modes were recorded.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill color="navy">Pre-mortem</Pill>
        <span style={{ fontSize: 11, color: "var(--slate-light)" }}>{formatDateTime(preMortem.createdAt)}</span>
        {preMortem.provenanceContentHash && (
          <span className="font-mono" style={{ fontSize: 11, color: "var(--slate-light)" }}>
            {preMortem.provenanceContentHash.slice(0, 12)}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {preMortem.failureModes.map((m) => (
          <div key={m.rank} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--cream-dark)", display: "grid", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span className="font-mono" style={{ fontSize: 12, color: "var(--slate-light)" }}>
                {String(m.rank).padStart(2, "0")}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--navy)" }}>{m.title}</span>
              {m.likelihood && <Pill color="amber">{m.likelihood}</Pill>}
            </div>
            {m.mechanism && <div style={{ fontSize: 12.5, color: "var(--slate)", lineHeight: 1.5 }}>{m.mechanism}</div>}
            {m.earlyWarning && (
              <div style={{ fontSize: 12, color: "var(--slate-light)", lineHeight: 1.5 }}>
                <span className="eyebrow" style={{ fontSize: 10, marginRight: 6 }}>
                  Early warning
                </span>
                {m.earlyWarning}
              </div>
            )}
          </div>
        ))}
      </div>
      {preMortem.residualRiskNote && (
        <div style={{ fontSize: 12.5, color: "var(--slate)", lineHeight: 1.5 }}>
          <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10, marginRight: 8 }}>
            Residual risk
          </span>
          {preMortem.residualRiskNote}
        </div>
      )}
      {preMortem.indicators.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {preMortem.indicators.map((ind) => (
            <IndicatorRow
              key={ind.id}
              indicator={ind}
              tenantId={tenantId}
              canWrite={canWrite}
              onChanged={onChanged}
              onUnauthorized={onUnauthorized}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const IND_STATUS: Record<PreMortemIndicatorStatus, { color: "gray" | "coral" | "teal"; label: string }> = {
  active: { color: "gray", label: "Watching" },
  triggered: { color: "coral", label: "Triggered" },
  cleared: { color: "teal", label: "Cleared" },
};

// One early-warning indicator, with the human's honest report of what they
// observed. A non-viewer can mark it triggered (the sign appeared), cleared (the
// concern passed) or back to a plain watch; the push evaluator surfaces an active
// or triggered indicator on an open commit.
function IndicatorRow({
  indicator,
  tenantId,
  canWrite,
  onChanged,
  onUnauthorized,
}: {
  indicator: PreMortemIndicator;
  tenantId: string;
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
  onUnauthorized: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = IND_STATUS[indicator.status];

  async function set(status: PreMortemIndicatorStatus) {
    if (busy || status === indicator.status) return;
    setBusy(true);
    setError(null);
    const out = await setIndicatorStatus(tenantId, indicator.id, status);
    setBusy(false);
    if ("unauthorized" in out) return void onUnauthorized();
    if ("error" in out) {
      setError("Could not update this indicator.");
      return;
    }
    await onChanged();
  }

  const options: PreMortemIndicatorStatus[] = ["active", "triggered", "cleared"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
      <Pill color={s.color}>{s.label}</Pill>
      <span style={{ color: "var(--navy)" }}>{indicator.label}</span>
      {indicator.triggeredAt && (
        <span style={{ fontSize: 11, color: "var(--slate-light)" }}>triggered {formatDateTime(indicator.triggeredAt)}</span>
      )}
      {indicator.clearedAt && (
        <span style={{ fontSize: 11, color: "var(--slate-light)" }}>cleared {formatDateTime(indicator.clearedAt)}</span>
      )}
      {canWrite && (
        <span style={{ display: "inline-flex", gap: 6 }}>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={opt === indicator.status ? "btn" : "btn-ghost"}
              onClick={() => set(opt)}
              disabled={busy || opt === indicator.status}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              {IND_STATUS[opt].label}
            </button>
          ))}
        </span>
      )}
      {error && <span style={{ fontSize: 12, color: "var(--coral-ink)" }}>{error}</span>}
    </div>
  );
}
