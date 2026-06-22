import React, { useCallback, useEffect, useState } from "react";
import type { ConnectorHealthReport, ConnectorHealthRow } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { fetchConnectorHealth } from "../../lib/securityApi";
import { ErrorState, SectionHeading, SkeletonLines } from "../primitives";
import { formatDateTime } from "../primitives/format";

type State =
  | { kind: "loading" }
  | { kind: "ready"; report: ConnectorHealthReport }
  | { kind: "error" };

const HEALTH_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  healthy: { label: "Healthy", cls: "text-teal-ink bg-teal-faint", dot: "bg-teal-ink" },
  degraded: { label: "Degraded", cls: "text-amber-ink bg-amber-faint", dot: "bg-amber-ink" },
  error: { label: "Error", cls: "text-coral-ink bg-coral-faint", dot: "bg-coral-ink" },
};

function HealthPill({ health }: { health: string }) {
  const s =
    HEALTH_STYLE[health] ?? { label: health, cls: "text-slate-base bg-cream-dark", dot: "bg-slate-base" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 py-[3px] px-2.5 rounded-full text-xs font-semibold ${s.cls}`}
    >
      <span className={`w-[7px] h-[7px] rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// The owner's read-time view of every connection's operational health for a
// tenant. Health is derived server-side from the real last-success and
// last-error timestamps and the connector's staleness threshold; nothing here is
// fabricated. A connection that has never run reads as degraded, never healthy,
// and a tenant with no connections shows an honest empty state.
export function ConnectorHealthSection({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const out = await fetchConnectorHealth(tenantId);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) return setState({ kind: "error" });
    setState({ kind: "ready", report: out.data });
  }, [tenantId, logout]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="grid gap-4">
      <SectionHeading eyebrow="Operational health" title="Connector health" />
      {state.kind === "loading" && <SkeletonLines lines={4} />}
      {state.kind === "error" && (
        <ErrorState message="Connector health could not be loaded." onRetry={load} />
      )}
      {state.kind === "ready" && state.report.connections.length === 0 && (
        <div className="card text-[14px] text-slate-base leading-normal">
          No connectors are configured for this tenant yet. Health appears here once a connection
          runs.
        </div>
      )}
      {state.kind === "ready" && state.report.connections.length > 0 && (
        <div className="card p-0 overflow-hidden">
          {state.report.connections.map((c, i) => (
            <ConnectorHealthItem key={c.connectorKey} row={c} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectorHealthItem({ row, first }: { row: ConnectorHealthRow; first: boolean }) {
  return (
    <div className={`py-4 px-5 grid gap-1.5 ${first ? "" : "border-t border-border-base"}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[14px] font-semibold text-navy">
          {row.name}
          {row.deployment && (
            <span className="font-mono text-meta text-slate-base ml-2">
              {row.deployment}
            </span>
          )}
        </span>
        <HealthPill health={row.health} />
      </div>
      <div className="text-caption text-slate-base leading-normal">
        {row.lastSuccessAt
          ? `Last success ${formatDateTime(row.lastSuccessAt)}.`
          : "No successful run recorded yet."}
        {row.health === "error" && row.lastErrorMessage
          ? ` Last error: ${row.lastErrorMessage}`
          : row.health === "error" && row.lastErrorCode
            ? ` Last error (${row.lastErrorCode}).`
            : ""}
      </div>
    </div>
  );
}
