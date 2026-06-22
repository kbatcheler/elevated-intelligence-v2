import React, { useState } from "react";
import { recordDecision } from "../../lib/decisionApi";
import { Link } from "../../lib/router";
import { Pill } from "../primitives";
import { decisionErrorText } from "../../lib/decisionView";

// Decision ledger (Phase AL) action control. Attached to a single recommended
// action, it lets a non-viewer seat record that the board deliberately did NOT
// take it: a defer (revisit later) or a reject (decline outright), each with a
// required rationale. It never edits or removes the recommendation; the audit
// captures the call, by whom, and why. A commit is recorded by committing the
// action elsewhere, so only the two contrarian decisions live here.

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
      setError(decisionErrorText(out.error));
      return;
    }
    setRecorded(kind);
    setKind(null);
    setRationale("");
  }

  if (recorded) {
    return (
      <div className="mt-3 flex items-center gap-2.5 flex-wrap">
        <Pill color={recorded === "defer" ? "amber" : "coral"}>{recorded === "defer" ? "Deferred" : "Rejected"}</Pill>
        <span className="text-xs text-slate-light">Recorded in the decision ledger.</span>
        <Link to="/decisions" className="text-xs text-blue-base no-underline">
          View timeline
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-dashed border-border-base pt-3 grid gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="eyebrow text-slate-light text-[10px]">
          Record a decision
        </span>
        <button
          type="button"
          className={`${kind === "defer" ? "btn" : "btn-ghost"} text-xs`}
          onClick={() => setKind(kind === "defer" ? null : "defer")}
          disabled={submitting}
        >
          Defer
        </button>
        <button
          type="button"
          className={`${kind === "reject" ? "btn" : "btn-ghost"} text-xs`}
          onClick={() => setKind(kind === "reject" ? null : "reject")}
          disabled={submitting}
        >
          Reject
        </button>
      </div>

      {kind && (
        <div className="grid gap-2">
          <label className="eyebrow text-slate-light text-[10px]">
            Why is the board {kind === "defer" ? "deferring" : "rejecting"} this action?
          </label>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            maxLength={4000}
            rows={3}
            disabled={submitting}
            placeholder="The recommendation stays in the diagnosis; this records that it was deliberately not taken, by whom, and why."
            className="w-full resize-y text-[13.5px] leading-normal py-2 px-2.5 rounded-lg border border-border-base text-navy bg-cream [font-family:inherit]"
          />
          <div className="flex items-center gap-2.5 flex-wrap">
            <button type="button" className="btn text-xs" onClick={onSubmit} disabled={!canSubmit}>
              {submitting ? "Recording..." : `Record ${kind}`}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setKind(null);
                setError(null);
              }}
              disabled={submitting}
            >
              Cancel
            </button>
            <span className="text-meta text-slate-light">{trimmed.length}/4000</span>
          </div>
          {error && <span className="text-[12.5px] text-coral-ink">{error}</span>}
        </div>
      )}
    </div>
  );
}
