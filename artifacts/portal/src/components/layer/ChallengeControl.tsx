import React, { useState } from "react";
import type { FindingChallenge } from "../../types";
import { submitChallenge } from "../../lib/challengeApi";
import { formatDateTime, Pill } from "../primitives";

// Interactive Challenge (Phase AA) finding control. Attached to a single finding
// (a cause, action, hypothesis or metric) it lets a non-viewer seat object to or
// add context for that finding; the engine re-reasons it and records an
// append-only verdict (uphold OR revise with a new confidence). It NEVER deletes
// or rewrites the finding, and a revise is shown as "modelled, user-informed",
// distinct from the layer's verified|modelled basis. The prior history for the
// finding renders here too, each row honestly flagged as addressing the live
// version or a prior one.

const ERROR_LABEL: Record<string, string> = {
  invalid_input: "That challenge could not be submitted. Add a short objection and try again.",
  forbidden: "Your seat can read challenges but cannot raise one.",
  finding_not_found: "This finding is no longer present to challenge.",
  layer_not_found: "This layer is no longer available to challenge.",
  profile_missing: "This company has no profile yet, so its findings cannot be re-reasoned.",
  failed: "The challenge could not be completed. Try again.",
};

function errorText(code: string): string {
  return ERROR_LABEL[code] ?? ERROR_LABEL.failed;
}

export function ChallengeControl({
  tenantId,
  layerKey,
  findingRef,
  prior,
  canChallenge,
  onChallenged,
  onUnauthorized,
}: {
  tenantId: string;
  layerKey: string;
  findingRef: string;
  prior: FindingChallenge[];
  canChallenge: boolean;
  onChallenged: (challenge: FindingChallenge) => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 2000 && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const out = await submitChallenge(tenantId, layerKey, findingRef, trimmed);
    setSubmitting(false);
    if ("unauthorized" in out) return void onUnauthorized();
    if ("error" in out) {
      setError(errorText(out.error));
      return;
    }
    setText("");
    setOpen(false);
    onChallenged(out.challenge);
  }

  return (
    <div style={{ marginTop: 14, borderTop: "1px dashed var(--border)", paddingTop: 12, display: "grid", gap: 10 }}>
      {prior.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {prior.map((c) => (
            <ChallengeRecord key={c.id} c={c} />
          ))}
        </div>
      )}

      {canChallenge && !open && (
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setOpen(true)}
          style={{ justifySelf: "start", fontSize: 12.5 }}
        >
          Challenge this finding
        </button>
      )}

      {canChallenge && open && (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10 }}>
            Your objection or added context
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            disabled={submitting}
            placeholder="What does this finding miss, or what context should the engine weigh? The engine re-reasons it; your input is context, not an override."
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
            <button type="button" className="btn" onClick={onSubmit} disabled={!canSubmit} style={{ fontSize: 12.5 }}>
              {submitting ? "Re-reasoning..." : "Submit challenge"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={submitting}
              style={{ fontSize: 12.5 }}
            >
              Cancel
            </button>
            <span style={{ fontSize: 11, color: "var(--slate-light)" }}>
              {trimmed.length}/2000
            </span>
          </div>
          {submitting && (
            <span style={{ fontSize: 12, color: "var(--slate-light)" }}>
              Routing to the Confounder and Synthesist seats. This makes two live model calls and can take a moment.
            </span>
          )}
          {error && <span style={{ fontSize: 12.5, color: "var(--coral-ink)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

// One recorded challenge. A completed challenge shows the verdict and the
// engine's re-reasoning; a failed one shows the honest failure. A revise shows
// the confidence change and the "modelled, user-informed" basis.
function ChallengeRecord({ c }: { c: FindingChallenge }) {
  const failed = c.status === "failed";
  const revised = c.outcome === "revised";
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 12px",
        background: "var(--cream-dark)",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {failed ? (
          <Pill color="coral">Challenge failed</Pill>
        ) : revised ? (
          <Pill color="amber">Revised</Pill>
        ) : (
          <Pill color="teal">Upheld</Pill>
        )}
        {!failed && c.isCurrentVersion === false && (
          <span style={{ fontSize: 11, color: "var(--slate-light)" }}>Addresses a prior version of this finding</span>
        )}
        {!failed && c.isCurrentVersion === true && (
          <span style={{ fontSize: 11, color: "var(--slate-light)" }}>Addresses the current finding</span>
        )}
      </div>

      <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>
        <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10, marginRight: 8 }}>
          Challenge
        </span>
        {c.challengeText}
      </div>

      {failed ? (
        c.error && (
          <div style={{ fontSize: 12.5, color: "var(--coral-ink)", lineHeight: 1.5 }}>
            The re-reasoning did not complete ({c.error}). Nothing about the finding changed.
          </div>
        )
      ) : (
        <>
          {c.reasoning && (
            <div style={{ fontSize: 13, color: "var(--navy)", lineHeight: 1.55 }}>{c.reasoning}</div>
          )}
          {c.confounderNote && (
            <div style={{ fontSize: 12.5, color: "var(--slate)", lineHeight: 1.5 }}>
              <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10, marginRight: 8 }}>
                Confounder re-examination
              </span>
              {c.confounderNote}
            </div>
          )}
          {revised && c.revisedConfidence != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {c.originalConfidence != null && (
                <span className="font-mono" style={{ fontSize: 12.5, color: "var(--slate-light)" }}>
                  {c.originalConfidence}
                  {" -> "}
                  {c.revisedConfidence}
                </span>
              )}
              <span className="pill pill-amber">modelled, user-informed {c.revisedConfidence}%</span>
            </div>
          )}
        </>
      )}

      <div style={{ fontSize: 11, color: "var(--slate-light)" }}>
        {c.challengerEmail ?? "A removed user"}
        {" . "}
        {formatDateTime(c.createdAt)}
        {c.provenanceContentHash && (
          <span className="font-mono" style={{ marginLeft: 8 }}>
            {c.provenanceContentHash.slice(0, 12)}
          </span>
        )}
      </div>
    </div>
  );
}
