import React, { useEffect, useState } from "react";
import type {
  CommittedAction,
  OutcomeCalibration,
  OutcomeMeasurement,
  OutcomeMeasurementStatus,
  TenantOutcomes,
} from "../../types";
import { fetchActions } from "../../lib/tenantApi";
import { fetchOutcomes } from "../../lib/outcomeApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import {
  ConfidencePill,
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  Pill,
  SkeletonLines,
  formatDate,
  formatUsd,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; actions: CommittedAction[]; outcomes: TenantOutcomes | null }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

const STATUS = {
  committed: { color: "navy", label: "Committed" },
  in_progress: { color: "amber", label: "In progress" },
  done: { color: "teal", label: "Done" },
  dismissed: { color: "gray", label: "Dismissed" },
} as const;

const MEAS_STATUS: Record<OutcomeMeasurementStatus, { color: "teal" | "blue" | "coral" | "gray"; label: string }> = {
  realized: { color: "teal", label: "Realised" },
  on_track: { color: "blue", label: "On track" },
  missed: { color: "coral", label: "Missed" },
  pending: { color: "gray", label: "Pending" },
};

// Postgres numeric arrives as a string; parse for display only, tolerating null.
function num(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// The latest measurement per action. The outcomes feed is newest-first, so the
// first row seen for an action is its current state.
function latestByAction(ms: OutcomeMeasurement[]): Map<string, OutcomeMeasurement> {
  const map = new Map<string, OutcomeMeasurement>();
  for (const m of ms) if (!map.has(m.actionId)) map.set(m.actionId, m);
  return map;
}

// A signed dollar variance: + when realized beat the prediction, - when it fell
// short. Null variance renders nothing, never a fabricated zero.
function varianceLabel(variance: number | null): string | null {
  if (variance == null) return null;
  if (variance > 0) return `+${formatUsd(variance)}`;
  return formatUsd(variance);
}

// The calibration grade. An honest "not enough signal yet" when nothing has
// resolved, never a fabricated score.
function CalibrationBadge({ calibration }: { calibration: OutcomeCalibration }) {
  if (calibration.score === null) {
    return <Pill color="gray">Calibration: not enough signal yet</Pill>;
  }
  const pct = Math.round(calibration.score * 100);
  const color = pct >= 70 ? "teal" : pct >= 40 ? "amber" : "coral";
  return (
    <Pill color={color}>
      Calibration {pct}% ({calibration.hits}/{calibration.resolved} resolved
      {calibration.misses > 0 ? `, ${calibration.misses} missed` : ""})
    </Pill>
  );
}

// The value counter: cumulative value identified versus value realized. Both are
// computed from persisted rows on the server, so the figures here reconcile
// exactly to a direct database sum.
function ValueCounter({ outcomes }: { outcomes: TenantOutcomes }) {
  const { summary } = outcomes;
  return (
    <div className="card grid gap-3.5">
      <div className="flex gap-8 flex-wrap">
        <div>
          <div className="eyebrow text-slate-light">
            Value identified
          </div>
          <div className="font-serif text-[26px] text-navy">
            {formatUsd(summary.valueIdentifiedUsd)}
          </div>
          <div className="text-xs text-slate-light">
            {summary.actionsWithPrediction} action{summary.actionsWithPrediction === 1 ? "" : "s"} with a
            dollar prediction
          </div>
        </div>
        <div>
          <div className="eyebrow text-slate-light">
            Value realised
          </div>
          <div className="font-serif text-[26px] text-teal">
            {formatUsd(summary.valueRealizedUsd)}
          </div>
          <div className="text-xs text-slate-light">
            {summary.actionsMeasured} action{summary.actionsMeasured === 1 ? "" : "s"} measured
          </div>
        </div>
      </div>
      <div>
        <CalibrationBadge calibration={summary.calibration} />
      </div>
    </div>
  );
}

// The track record. E5 adds committing and status changes from the layer
// actions. E2 lists what has already been committed for the current tenant,
// with honest pending states and the real predicted impact, never a fabricated
// outcome. W elevates this surface with the outcome loop: the value counter and
// the per-action realized value, variance, and basis behind it.
export function ActionsPage() {
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
    Promise.all([fetchActions(currentId), fetchOutcomes(currentId)]).then(([actionsOut, outcomesOut]) => {
      if (!alive) return;
      if ("unauthorized" in actionsOut || "unauthorized" in outcomesOut) return void logout();
      if (actionsOut.state === "error") return setState({ kind: "error" });
      if (actionsOut.state === "empty") return setState({ kind: "empty" });
      // The counter is supplementary: if it fails to load we still show the
      // track record, just without the headline figures.
      const outcomes = outcomesOut.state === "ready" ? outcomesOut.data : null;
      setState({ kind: "ready", actions: actionsOut.items, outcomes });
    });
    return () => {
      alive = false;
    };
  }, [currentId, tenantStatus, logout]);

  const measByAction =
    state.kind === "ready" && state.outcomes
      ? latestByAction(state.outcomes.measurements)
      : new Map<string, OutcomeMeasurement>();

  return (
    <PageWidth space="page">
      <PageHeader
        eyebrow="Track record"
        title="Committed actions"
        subtitle={current ? `Actions committed for ${current.name}, with their predicted impact and realised value.` : undefined}
      />
      <div className="mt-7">
        {state.kind === "loading" && <SkeletonLines lines={4} />}
        {state.kind === "error" && (
          <ErrorState message="Committed actions could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organisation, its track record will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState
            title="No actions committed yet"
            message="Commit an action from a layer to start building the track record."
          />
        )}
        {state.kind === "ready" && (
          <div className="grid gap-4">
            {state.outcomes && <ValueCounter outcomes={state.outcomes} />}
            <div className="grid gap-3">
              {state.actions.map((a) => {
                const s = STATUS[a.status] ?? { color: "gray" as const, label: a.status };
                const predicted = num(a.predictedValueUsd);
                const meas = measByAction.get(a.id);
                const realized = meas ? num(meas.realizedValueUsd) : null;
                const variance = meas ? varianceLabel(num(meas.varianceVsPrediction)) : null;
                return (
                  <div key={a.id} className="card grid gap-2">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <span className="font-serif text-lead text-navy">
                        {a.title}
                      </span>
                      <Pill color={s.color}>{s.label}</Pill>
                    </div>
                    {a.detail && <div className="text-[14px] text-slate-base leading-normal">{a.detail}</div>}
                    <div className="flex gap-3.5 flex-wrap items-center text-xs text-slate-light">
                      {a.predictedImpact && <span>Predicted: {a.predictedImpact}</span>}
                      {predicted !== null && <span>Predicted value: {formatUsd(predicted)}</span>}
                      {a.timing && <span>Timing: {a.timing}</span>}
                      {a.actionOwner && <span>Owner: {a.actionOwner}</span>}
                      <span>Committed {formatDate(a.committedAt)}</span>
                      <ConfidencePill basis={a.basis} confidence={a.confidence} />
                    </div>
                    {meas && (
                      <div className="flex gap-3.5 flex-wrap items-center text-xs text-slate-light border-t border-cream-dark pt-2">
                        {realized !== null && <span>Realised: {formatUsd(realized)}</span>}
                        {variance && <span>Variance: {variance}</span>}
                        <Pill color={MEAS_STATUS[meas.status].color}>{MEAS_STATUS[meas.status].label}</Pill>
                        <Pill color={meas.basis === "measured" ? "teal" : "amber"}>
                          {meas.basis === "measured" ? "Measured" : "Modelled"}
                        </Pill>
                        <span>Measured {formatDate(meas.measuredAt)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </PageWidth>
  );
}
