import React, { useCallback, useEffect, useState } from "react";
import type { KeyStatus } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { fetchKeyStatus } from "../../lib/securityApi";
import { ErrorState, SectionHeading, SkeletonLines } from "../primitives";
import { ConnectedPill, KeyStatusPill } from "./shared";
import { ConnectorHealthSection } from "./ConnectorHealthSection";

type State =
  | { kind: "loading" }
  | { kind: "ready"; key: KeyStatus }
  | { kind: "error" };

// The security posture OF the data connection: how this tenant's data is
// protected at rest. Every fact is read from the real key and KMS status. This
// panel takes no lifecycle action (that lives under Posture) and invents no
// connector-run or tenant-connection telemetry it cannot prove.
export function ConnectionsSecurityPanel({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const out = await fetchKeyStatus(tenantId);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) return setState({ kind: "error" });
    setState({ kind: "ready", key: out.data });
  }, [tenantId, logout]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === "loading") return <SkeletonLines lines={5} />;
  if (state.kind === "error") {
    return <ErrorState message="The connection security posture could not be loaded." onRetry={load} />;
  }

  const { key } = state;
  const readable = key.status === "active";

  const rows: { label: string; value: React.ReactNode; note: string }[] = [
    {
      label: "Encryption at rest",
      value: <KeyStatusPill status={key.status} />,
      note: readable
        ? "Human signals for this connection are encrypted with a live per-tenant key."
        : key.status === "revoked"
          ? "The key was revoked. Stored signals are crypto-shredded and cannot be read."
          : "No key is provisioned, so no encrypted signals exist for this connection yet.",
    },
    {
      label: "Wrapping KMS",
      value: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="font-mono" style={{ fontSize: 13, color: "var(--navy)" }}>
            {key.kms.provider}
          </span>
          <ConnectedPill connected={key.kms.connected} />
        </span>
      ),
      note: key.kms.detail,
    },
    {
      label: "Customer-managed KMS",
      value: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="font-mono" style={{ fontSize: 13, color: "var(--navy)" }}>
            {key.customerKms.provider}
          </span>
          <ConnectedPill connected={key.customerKms.connected} />
        </span>
      ),
      note: key.customerKms.detail,
    },
  ];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <SectionHeading eyebrow="Connection security" title="Data protection for this tenant" />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              padding: "16px 20px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>{r.label}</span>
              {r.value}
            </div>
            <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>{r.note}</div>
          </div>
        ))}
      </div>

      <ConnectorHealthSection tenantId={tenantId} />
    </div>
  );
}
