import React, { useState } from "react";
import { recordDecision } from "../../lib/decisionApi";
import { Link } from "../../lib/router";
import { Pill } from "../primitives";

// Decision ledger (Phase AL) action control. Attached to a single recommended
// action, it lets a non-viewer seat record that the board deliberately did NOT
// take it: a defer (revisit later) or a reject (decline outright), each with a
// required rationale. It never edits or removes the recommendation; the audit
// captures the call, by whom, and why. A commit is recorded by committing the
// action elsewhere, so only the two contrarian decisions live here.

const ERROR_LABEL: Record<string, string> = {
  invalid_input: "Add a short rationale and try again.",
  forbidden: "Your seat can read decisions but cannot record one.",
  action_not_found: "This action is no longer present to decide on.",
  layer_not_found: "This layer is no longer available.",
  not_an_action: "A decision can only be recorded against a recommended action.",
  failed: "The decision could not be recorded. Try again.",
};

function errorText(code: string): string {
  return ERROR_LABEL[code] ?? ERROR_LABEL.failed;
}

export function DecisionControl({
  tenantId,
  layerKey,
  actionRef,
  onUnauthorized,
}: {
  tenantId: string;
  layerKey: string;
  actionRef: string;
  onUnauthorized: () => void;
}) {
  const [kind, setKind] = useState<"defer" | "reject" | null>(null);
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<"defer" | "reject" | null>(null);

  const trimmed = rationale.trim();
  const canSubmit = kind !== null && trimmed.length > 0 && trimmed.length <= 4000 && !submitting;

  async function onSubmit() {
    if (!canSubmit || kind === null) return;
    setSubmitting(true);
    setError(null);
    const out = await recordDecision(tenantId, { layerKey, actionRef, decision: kind, rationale: trimmed });
    setSubmitting(false);
    if ("unauthorized" in out) return void onUnauthorized();
    if ("error" in out) {
      setError(errorText(out.error));
      return;
    }
    setRecorded(kind);
    setKind(null);
    setRationale("");
  }

  if (recorded) {
    return (
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pill color={recorded === "defer" ? "amber" : "coral"}>{recorded === "defer" ? "Deferred" : "Rejected"}</Pill>
        <span style={{ fontSize: 12, color: "var(--slate-light)" }}>Recorded in the decision ledger.</span>
        <Link to="/decisions" style={{ fontSize: 12, color: "var(--blue)", textDecoration: "none" }}>
          View timeline
        </Link>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px dashed var(--border)", paddingTop: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10 }}>
          Record a decision
        </span>
        <button
          type="button"
          className={kind === "defer" ? "btn" : "btn-ghost"}
          onClick={() => setKind(kind === "defer" ? null : "defer")}
          disabled={submitting}
          style={{ fontSize: 12 }}
        >
          Defer
        </button>
        <button
          type="button"
          className={kind === "reject" ? "btn" : "btn-ghost"}
          onClick={() => setKind(kind === "reject" ? null : "reject")}
          disabled={submitting}
          style={{ fontSize: 12 }}
        >
          Reject
        </button>
      </div>

      {kind && (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10 }}>
            Why is the board {kind === "defer" ? "deferring" : "rejecting"} this action?
          </label>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            maxLength={4000}
            rows={3}
            disabled={submitting}
            placeholder="The recommendation stays in the diagnosis; this records that it was deliberately not taken, by whom, and why."
            style={{
              width: "100%",
              resize: "vertical",
              fontSize: 13.5,
              lineHeight: 1.5,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              color: "var(--navy)",
              background: "var(--cream)",
              fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={onSubmit} disabled={!canSubmit} style={{ fontSize: 12 }}>
              {submitting ? "Recording..." : `Record ${kind}`}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setKind(null);
                setError(null);
              }}
              disabled={submitting}
              style={{ fontSize: 12 }}
            >
              Cancel
            </button>
            <span style={{ fontSize: 11, color: "var(--slate-light)" }}>{trimmed.length}/4000</span>
          </div>
          {error && <span style={{ fontSize: 12.5, color: "var(--coral-ink)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
