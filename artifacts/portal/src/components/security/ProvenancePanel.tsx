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
    <div className="grid gap-5">
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
      <div className="card card-accent-teal flex gap-3 items-start">
        <CheckCircle2 size={18} color="var(--teal)" className="shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-navy mb-1">Chain intact</div>
          <div className="text-caption text-slate-base">
            All {result.length} {result.length === 1 ? "entry" : "entries"} hash-link cleanly back to the genesis record. No tampering detected.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="card card-accent-coral flex gap-3 items-start">
      <AlertTriangle size={18} color="var(--coral)" className="shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold text-coral-ink mb-1">
          Chain broken{typeof result.brokenAt === "number" ? ` at entry #${result.brokenAt}` : ""}
        </div>
        <div className="text-caption text-slate-base">
          {result.detail ?? "The ledger failed verification."} Chain length at failure: {result.length}.
        </div>
      </div>
    </div>
  );
}
