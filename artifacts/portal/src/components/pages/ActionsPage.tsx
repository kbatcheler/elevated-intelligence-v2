import React, { useEffect, useState } from "react";
import type { CommittedAction } from "../../types";
import { fetchActions } from "../../lib/tenantApi";
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
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; actions: CommittedAction[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

const STATUS = {
  committed: { color: "navy", label: "Committed" },
  in_progress: { color: "amber", label: "In progress" },
  done: { color: "teal", label: "Done" },
  dismissed: { color: "gray", label: "Dismissed" },
} as const;

// The track record. E5 adds committing and status changes from the layer
// actions. E2 lists what has already been committed for the current tenant,
// with honest pending states and the real predicted impact, never a fabricated
// outcome.
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
    fetchActions(currentId).then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "error") return setState({ kind: "error" });
      if (out.state === "empty") return setState({ kind: "empty" });
      setState({ kind: "ready", actions: out.items });
    });
    return () => {
      alive = false;
    };
  }, [currentId, tenantStatus, logout]);

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Track record"
        title="Committed actions"
        subtitle={current ? `Actions committed for ${current.name}, with their predicted impact.` : undefined}
      />
      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={4} />}
        {state.kind === "error" && (
          <ErrorState message="Committed actions could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its track record will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState
            title="No actions committed yet"
            message="Commit an action from a layer to start building the track record."
          />
        )}
        {state.kind === "ready" && (
          <div style={{ display: "grid", gap: 12 }}>
            {state.actions.map((a) => {
              const s = STATUS[a.status] ?? { color: "gray" as const, label: a.status };
              return (
                <div key={a.id} className="card" style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span className="font-serif" style={{ fontSize: 17, color: "var(--navy)" }}>
                      {a.title}
                    </span>
                    <Pill color={s.color}>{s.label}</Pill>
                  </div>
                  {a.detail && <div style={{ fontSize: 14, color: "var(--slate)", lineHeight: 1.5 }}>{a.detail}</div>}
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--slate-light)" }}>
                    {a.predictedImpact && <span>Predicted: {a.predictedImpact}</span>}
                    {a.timing && <span>Timing: {a.timing}</span>}
                    {a.actionOwner && <span>Owner: {a.actionOwner}</span>}
                    <span>Committed {formatDate(a.committedAt)}</span>
                    <ConfidencePill basis={a.basis} confidence={a.confidence} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageWidth>
  );
}
