import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Lock, ShieldOff } from "lucide-react";
import type { HumanSignal } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { fetchHumanSignals } from "../../lib/securityApi";
import { EmptyState, ErrorState, PageHeader, PageWidth, SkeletonLines } from "../primitives";
import { formatDateTime } from "../primitives/format";
import { TenantGate } from "../security/shared";

// The all-role human signal read. Unlike the rest of the security surface this
// is NOT owner-only: any seat may reach it, but only under an active break-glass
// grant. Each backend failure code maps to its own honest state, never an empty
// list. Values are rendered exactly as decrypted and never cached or exported.
export function BreakGlassPage() {
  return (
    <PageWidth space="tall">
      <PageHeader
        eyebrow="Break-glass"
        title="Human signal read"
        subtitle="Decrypted human signals for the current tenant. Reachable only under an active, owner-approved break-glass grant. Every read is recorded."
      />
      <div className="mt-7">
        <TenantGate>{(tenantId) => <SignalsReader tenantId={tenantId} />}</TenantGate>
      </div>
    </PageWidth>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; signals: HumanSignal[] }
  | { kind: "empty" }
  | { kind: "grant_required"; detail: string | null }
  | { kind: "crypto_shredded"; detail: string | null }
  | { kind: "signal_unreadable"; detail: string | null }
  | { kind: "error" };

function SignalsReader({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const out = await fetchHumanSignals(tenantId);
    if ("unauthorized" in out) return void logout();
    switch (out.state) {
      case "ready":
        return setState({ kind: "ready", signals: out.signals });
      case "empty":
        return setState({ kind: "empty" });
      case "break_glass_required":
        return setState({ kind: "grant_required", detail: out.detail });
      case "crypto_shredded":
        return setState({ kind: "crypto_shredded", detail: out.detail });
      case "signal_unreadable":
        return setState({ kind: "signal_unreadable", detail: out.detail });
      default:
        return setState({ kind: "error" });
    }
  }, [tenantId, logout]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === "loading") return <SkeletonLines lines={6} />;
  if (state.kind === "error") return <ErrorState message="The signal read could not be completed." onRetry={load} />;

  if (state.kind === "grant_required") {
    return (
      <Notice
        tone="amber"
        icon={<Lock size={18} color="var(--amber)" />}
        title="Break-glass grant required"
        body={
          state.detail ??
          "You do not hold an active break-glass grant for this tenant. An owner must grant time-boxed access before signals can be read."
        }
      />
    );
  }
  if (state.kind === "crypto_shredded") {
    return (
      <Notice
        tone="coral"
        icon={<ShieldOff size={18} color="var(--coral)" />}
        title="Signals crypto-shredded"
        body={state.detail ?? "This tenant's key has been revoked. The encrypted signals can no longer be decrypted."}
      />
    );
  }
  if (state.kind === "signal_unreadable") {
    return (
      <Notice
        tone="coral"
        icon={<AlertTriangle size={18} color="var(--coral)" />}
        title="Signals unreadable"
        body={state.detail ?? "The stored signals could not be decrypted with the active key."}
      />
    );
  }
  if (state.kind === "empty") {
    return (
      <EmptyState
        title="No signals to show"
        message="Your grant is active, but this tenant has no stored human signals yet."
      />
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Signal</th>
              <th>Value</th>
              <th>Window</th>
              <th>Source</th>
              <th>Computed</th>
            </tr>
          </thead>
          <tbody>
            {state.signals.map((s, i) => (
              <tr key={`${s.layerKey}:${s.signalKey}:${i}`}>
                <td className="font-mono text-xs text-navy">
                  {s.layerKey}
                </td>
                <td className="font-mono text-xs text-navy">
                  {s.signalKey}
                </td>
                <td className="font-mono text-xs text-slate-base">
                  {formatValue(s.value)}
                </td>
                <td className="text-xs text-slate-base">{s.window ?? "-"}</td>
                <td className="text-xs text-slate-base">{s.sourceConnectorKey ?? "-"}</td>
                <td className="text-xs text-slate-base">{formatDateTime(s.computedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// A decrypted value rendered exactly as the math produced it: a scalar verbatim,
// a vector bracketed and comma-joined. Non-finite entries show a plain dash.
function formatValue(value: number | number[]): string {
  if (Array.isArray(value)) {
    return "[" + value.map((n) => (Number.isFinite(n) ? String(n) : "-")).join(", ") + "]";
  }
  return Number.isFinite(value) ? String(value) : "-";
}

function Notice({
  tone,
  icon,
  title,
  body,
}: {
  tone: "amber" | "coral";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className={`card card-accent-${tone} flex gap-3 items-start`}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div>
        <div className={`font-semibold mb-1 ${tone === "coral" ? "text-coral-ink" : "text-navy"}`}>
          {title}
        </div>
        <div className="text-caption text-slate-base leading-normal">{body}</div>
      </div>
    </div>
  );
}
