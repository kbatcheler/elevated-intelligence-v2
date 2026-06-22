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
    <PageWidth space="tall">
      <PageHeader
        eyebrow="Security"
        title="Security console"
        subtitle="Tenant key lifecycle, connection protection, break-glass access, and ledger integrity."
      />
      <div className="mt-6 mb-7 flex gap-4 border-b border-border-base overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-3 px-1 bg-transparent border-b-2 cursor-pointer text-[14px] whitespace-nowrap font-sans ${
              tab === t.key
                ? "border-navy text-navy font-semibold"
                : "border-transparent text-slate-light font-medium"
            }`}
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
