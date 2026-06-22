import React, { useEffect, useState } from "react";
import { fetchBenchmarkConsent, setBenchmarkConsent } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";

type State =
  | { kind: "loading" }
  | { kind: "ready"; optIn: boolean }
  | { kind: "error" };

// The tenant's participation in the verified-cohort data network. Participation
// is default-off and every change is logged server-side to an append-only audit.
// A client-viewer is a read-only seat and sees the state without a control, the
// same posture the API enforces. The toggle reflects the persisted opt state and
// never assumes success: it only flips after the server confirms the change.
export function BenchmarkConsent({ tenantId }: { tenantId: string }) {
  const { user, logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setError(null);
    fetchBenchmarkConsent(tenantId).then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "ready") setState({ kind: "ready", optIn: out.data.optIn });
      else if (out.state === "empty") setState({ kind: "ready", optIn: false });
      else setState({ kind: "error" });
    });
    return () => {
      alive = false;
    };
  }, [tenantId, logout]);

  const readOnly = user?.role === "client-viewer";

  const toggle = async () => {
    if (state.kind !== "ready" || saving || readOnly) return;
    setSaving(true);
    setError(null);
    const out = await setBenchmarkConsent(tenantId, !state.optIn);
    setSaving(false);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) {
      setError("Could not update participation. Please try again.");
      return;
    }
    setState({ kind: "ready", optIn: out.optIn });
  };

  const optIn = state.kind === "ready" ? state.optIn : false;

  return (
    <div className="card p-[18px] grid gap-3 grid-cols-[1fr_auto] items-center">
      <div className="min-w-0">
        <div className="eyebrow text-slate-light">
          Peer benchmarking
        </div>
        <div className="text-[14px] text-slate-base mt-1.5 leading-normal max-w-[620px]">
          Opt in to contribute this company's de-identified signals to its sector and revenue cohort,
          and to see where it sits against verified peers. No raw data and no company identity ever
          leaves the boundary; only k-anonymous percentile bands are shared. Participation is off by
          default and can be withdrawn at any time.
        </div>
        {state.kind === "ready" && (
          <div className={`text-caption mt-2 font-semibold ${optIn ? "text-teal-ink" : "text-slate-light"}`}>
            {optIn ? "Participating in the verified cohort" : "Not participating"}
          </div>
        )}
        {state.kind === "error" && (
          <div className="text-caption mt-2 text-coral-ink">
            Participation status is unavailable right now.
          </div>
        )}
        {error && (
          <div className="text-caption mt-2 text-coral-ink">{error}</div>
        )}
        {readOnly && state.kind === "ready" && (
          <div className="text-xs mt-2 text-slate-light">
            Your seat is read-only, so participation can only be changed by an administrator.
          </div>
        )}
      </div>

      <div className="justify-self-end">
        {state.kind === "loading" && (
          <span className="text-caption text-slate-light">Loading...</span>
        )}
        {state.kind === "ready" && !readOnly && (
          <button
            type="button"
            onClick={toggle}
            disabled={saving}
            className={`py-[9px] px-4 rounded-lg text-caption font-semibold border ${
              saving ? "cursor-default opacity-60" : "cursor-pointer opacity-100"
            } ${optIn ? "text-slate-base bg-cream-dark border-cream-dark" : "text-cream-light bg-navy border-navy"}`}
          >
            {saving ? "Saving..." : optIn ? "Withdraw" : "Opt in"}
          </button>
        )}
      </div>
    </div>
  );
}
