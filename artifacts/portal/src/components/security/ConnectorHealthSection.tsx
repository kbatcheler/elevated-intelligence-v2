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

const HEALTH_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  healthy: { label: "Healthy", color: "var(--teal-ink)", bg: "var(--teal-faint)" },
  degraded: { label: "Degraded", color: "var(--amber-ink)", bg: "var(--amber-faint)" },
  error: { label: "Error", color: "var(--coral-ink)", bg: "var(--coral-faint)" },
};

function HealthPill({ health }: { health: string }) {
  const s =
    HEALTH_STYLE[health] ?? { label: health, color: "var(--slate)", bg: "var(--cream-dark)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: s.color,
        background: s.bg,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: s.color }} />
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
    <div style={{ display: "grid", gap: 16 }}>
      <SectionHeading eyebrow="Operational health" title="Connector health" />
      {state.kind === "loading" && <SkeletonLines lines={4} />}
      {state.kind === "error" && (
        <ErrorState message="Connector health could not be loaded." onRetry={load} />
      )}
      {state.kind === "ready" && state.report.connections.length === 0 && (
        <div className="card" style={{ fontSize: 14, color: "var(--slate)", lineHeight: 1.5 }}>
          No connectors are configured for this tenant yet. Health appears here once a connection
          runs.
        </div>
      )}
      {state.kind === "ready" && state.report.connections.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
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
    <div
      style={{
        padding: "16px 20px",
        borderTop: first ? "none" : "1px solid var(--border)",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>
          {row.name}
          {row.deployment && (
            <span
              className="font-mono"
              style={{ fontSize: 11, color: "var(--slate)", marginLeft: 8 }}
            >
              {row.deployment}
            </span>
          )}
        </span>
        <HealthPill health={row.health} />
      </div>
      <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>
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
