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
    <div className="mt-3.5 border-t border-dashed border-border-base pt-3 grid gap-2.5">
      {prior.length > 0 && (
        <div className="grid gap-2">
          {prior.map((c) => (
            <ChallengeRecord key={c.id} c={c} />
          ))}
        </div>
      )}

      {canChallenge && !open && (
        <button
          type="button"
          className="btn-ghost justify-self-start text-[12.5px]"
          onClick={() => setOpen(true)}
        >
          Challenge this finding
        </button>
      )}

      {canChallenge && open && (
        <div className="grid gap-2">
          <label className="eyebrow text-slate-light text-[10px]">
            Your objection or added context
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            disabled={submitting}
            placeholder="What does this finding miss, or what context should the engine weigh? The engine re-reasons it; your input is context, not an override."
            className="w-full resize-y text-[13.5px] leading-normal py-2 px-2.5 rounded-lg border border-border-base text-navy bg-cream [font-family:inherit]"
          />
          <div className="flex items-center gap-2.5 flex-wrap">
            <button type="button" className="btn text-[12.5px]" onClick={onSubmit} disabled={!canSubmit}>
              {submitting ? "Re-reasoning..." : "Submit challenge"}
            </button>
            <button
              type="button"
              className="btn-ghost text-[12.5px]"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Cancel
            </button>
            <span className="text-meta text-slate-light">
              {trimmed.length}/2000
            </span>
          </div>
          {submitting && (
            <span className="text-xs text-slate-light">
              Routing to the Confounder and Synthesist seats. This makes two live model calls and can take a moment.
            </span>
          )}
          {error && <span className="text-[12.5px] text-coral-ink">{error}</span>}
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
    <div className="border border-border-base rounded-lg py-2.5 px-3 bg-cream-dark grid gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {failed ? (
          <Pill color="coral">Challenge failed</Pill>
        ) : revised ? (
          <Pill color="amber">Revised</Pill>
        ) : (
          <Pill color="teal">Upheld</Pill>
        )}
        {!failed && c.isCurrentVersion === false && (
          <span className="text-meta text-slate-light">Addresses a prior version of this finding</span>
        )}
        {!failed && c.isCurrentVersion === true && (
          <span className="text-meta text-slate-light">Addresses the current finding</span>
        )}
      </div>

      <div className="text-caption text-slate-base leading-normal">
        <span className="eyebrow text-slate-light text-[10px] mr-2">
          Challenge
        </span>
        {c.challengeText}
      </div>

      {failed ? (
        c.error && (
          <div className="text-[12.5px] text-coral-ink leading-normal">
            The re-reasoning did not complete ({c.error}). Nothing about the finding changed.
          </div>
        )
      ) : (
        <>
          {c.reasoning && (
            <div className="text-caption text-navy">{c.reasoning}</div>
          )}
          {c.confounderNote && (
            <div className="text-[12.5px] text-slate-base leading-normal">
              <span className="eyebrow text-slate-light text-[10px] mr-2">
                Confounder re-examination
              </span>
              {c.confounderNote}
            </div>
          )}
          {revised && c.revisedConfidence != null && (
            <div className="flex items-center gap-2 flex-wrap">
              {c.originalConfidence != null && (
                <span className="font-mono text-[12.5px] text-slate-light">
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

      <div className="text-meta text-slate-light">
        {c.challengerEmail ?? "A removed user"}
        {" . "}
        {formatDateTime(c.createdAt)}
        {c.provenanceContentHash && (
          <span className="font-mono ml-2">
            {c.provenanceContentHash.slice(0, 12)}
          </span>
        )}
      </div>
    </div>
  );
}
