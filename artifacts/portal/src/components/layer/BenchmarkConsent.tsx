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
    <div
      className="card"
      style={{ padding: 18, display: "grid", gap: 12, gridTemplateColumns: "1fr auto", alignItems: "center" }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{ color: "var(--slate-light)" }}>
          Peer benchmarking
        </div>
        <div style={{ fontSize: 14, color: "var(--slate)", marginTop: 6, lineHeight: 1.5, maxWidth: 620 }}>
          Opt in to contribute this company's de-identified signals to its sector and revenue cohort,
          and to see where it sits against verified peers. No raw data and no company identity ever
          leaves the boundary; only k-anonymous percentile bands are shared. Participation is off by
          default and can be withdrawn at any time.
        </div>
        {state.kind === "ready" && (
          <div style={{ fontSize: 13, marginTop: 8, fontWeight: 600, color: optIn ? "var(--teal)" : "var(--slate-light)" }}>
            {optIn ? "Participating in the verified cohort" : "Not participating"}
          </div>
        )}
        {state.kind === "error" && (
          <div style={{ fontSize: 13, marginTop: 8, color: "var(--coral)" }}>
            Participation status is unavailable right now.
          </div>
        )}
        {error && (
          <div style={{ fontSize: 13, marginTop: 8, color: "var(--coral)" }}>{error}</div>
        )}
        {readOnly && state.kind === "ready" && (
          <div style={{ fontSize: 12, marginTop: 8, color: "var(--slate-light)" }}>
            Your seat is read-only, so participation can only be changed by an administrator.
          </div>
        )}
      </div>

      <div style={{ justifySelf: "end" }}>
        {state.kind === "loading" && (
          <span style={{ fontSize: 13, color: "var(--slate-light)" }}>Loading...</span>
        )}
        {state.kind === "ready" && !readOnly && (
          <button
            type="button"
            onClick={toggle}
            disabled={saving}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
              color: optIn ? "var(--slate)" : "#fff",
              background: optIn ? "var(--cream-dark)" : "var(--navy)",
              border: optIn ? "1px solid var(--cream-dark)" : "1px solid var(--navy)",
            }}
          >
            {saving ? "Saving..." : optIn ? "Withdraw" : "Opt in"}
          </button>
        )}
      </div>
    </div>
  );
}
