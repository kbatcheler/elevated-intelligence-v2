import React, { useState } from "react";
import { PageHeader, PageWidth } from "../primitives";
import { TenantGate } from "./shared";
import { PosturePanel } from "./PosturePanel";
import { ConnectionsSecurityPanel } from "./ConnectionsSecurityPanel";
import { BreakGlassAdminPanel } from "./BreakGlassAdminPanel";
import { ProvenancePanel } from "./ProvenancePanel";

const TABS = [
  { key: "posture", label: "Posture" },
  { key: "connections", label: "Connections" },
  { key: "break-glass", label: "Break-glass" },
  { key: "provenance", label: "Provenance" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// The owner-only security console. It mirrors the access console's tabbed shape
// and sits behind the tenant gate so every panel is handed a concrete tenant.
export function SecurityConsole() {
  const [tab, setTab] = useState<TabKey>("posture");

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 96 }}>
      <PageHeader
        eyebrow="Security"
        title="Security console"
        subtitle="Tenant key lifecycle, connection protection, break-glass access, and ledger integrity."
      />
      <div style={{ margin: "24px 0 28px", display: "flex", gap: 16, borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "12px 4px",
              background: "transparent",
              border: "none",
              borderBottom: tab === t.key ? "2px solid var(--navy)" : "2px solid transparent",
              color: tab === t.key ? "var(--navy)" : "var(--slate-light)",
              fontWeight: tab === t.key ? 600 : 500,
              cursor: "pointer",
              fontSize: 14,
              whiteSpace: "nowrap",
              fontFamily: "Inter, sans-serif",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <TenantGate>
        {(tenantId) => (
          <>
            {tab === "posture" && <PosturePanel tenantId={tenantId} />}
            {tab === "connections" && <ConnectionsSecurityPanel tenantId={tenantId} />}
            {tab === "break-glass" && <BreakGlassAdminPanel tenantId={tenantId} />}
            {tab === "provenance" && <ProvenancePanel tenantId={tenantId} />}
          </>
        )}
      </TenantGate>
    </PageWidth>
  );
}
