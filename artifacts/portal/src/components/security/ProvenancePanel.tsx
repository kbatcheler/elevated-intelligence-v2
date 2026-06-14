import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCw } from "lucide-react";
import type { VerifyResult } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { verifyProvenance } from "../../lib/securityApi";
import { ErrorState, SectionHeading, SkeletonLines } from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; result: VerifyResult }
  | { kind: "error" };

// Verifies the tenant's append-only signal ledger by replaying its hash links.
// An intact chain and a broken one are reported with equal honesty: the broken
// case names the entry where the chain first fails and the reason given.
export function ProvenancePanel({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    setVerifying(true);
    const out = await verifyProvenance(tenantId);
    setVerifying(false);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) return setState({ kind: "error" });
    setState({ kind: "ready", result: out.data });
  }, [tenantId, logout]);

  useEffect(() => {
    setState({ kind: "loading" });
    load();
  }, [load]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <SectionHeading
        eyebrow="Provenance"
        title="Signal ledger integrity"
        action={
          <button className="btn-ghost" onClick={load} disabled={verifying}>
            {verifying ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Re-verify
          </button>
        }
      />
      {state.kind === "loading" && <SkeletonLines lines={3} />}
      {state.kind === "error" && <ErrorState message="The provenance chain could not be verified." onRetry={load} />}
      {state.kind === "ready" && <VerifyResultCard result={state.result} />}
    </div>
  );
}

function VerifyResultCard({ result }: { result: VerifyResult }) {
  if (result.ok) {
    return (
      <div className="card card-accent-teal" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <CheckCircle2 size={18} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, color: "var(--navy)", marginBottom: 4 }}>Chain intact</div>
          <div style={{ fontSize: 13, color: "var(--slate)" }}>
            All {result.length} {result.length === 1 ? "entry" : "entries"} hash-link cleanly back to the genesis record. No tampering detected.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="card card-accent-coral" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <AlertTriangle size={18} color="var(--coral)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 600, color: "var(--coral)", marginBottom: 4 }}>
          Chain broken{typeof result.brokenAt === "number" ? ` at entry #${result.brokenAt}` : ""}
        </div>
        <div style={{ fontSize: 13, color: "var(--slate)" }}>
          {result.detail ?? "The ledger failed verification."} Chain length at failure: {result.length}.
        </div>
      </div>
    </div>
  );
}
