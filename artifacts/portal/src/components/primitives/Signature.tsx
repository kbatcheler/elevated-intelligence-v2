import React from "react";

// The two signature surfaces of the product, built from the frozen vocabulary.

type DiagnosisTone = "navy" | "teal" | "amber" | "coral" | "gold";

// The tone colours the thin leading rule only. The conclusion itself always
// reads in navy authority, so a "bad" diagnosis is no less confident than a good
// one; the rule carries the sentiment.
const TONE_RULE: Record<DiagnosisTone, string> = {
  navy: "bg-navy",
  teal: "bg-teal",
  amber: "bg-amber-base",
  coral: "bg-coral",
  gold: "bg-gold",
};

// SerifDiagnosis: the product's single confident conclusion, set in the serif
// voice on a comfortable measure. An optional eyebrow above, the conclusion
// itself, an optional quiet supporting line, and an optional action beneath.
export function SerifDiagnosis({
  eyebrow,
  children,
  support,
  action,
  tone = "navy",
  lead = false,
}: {
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  support?: React.ReactNode;
  action?: React.ReactNode;
  tone?: DiagnosisTone;
  lead?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className={`w-[3px] shrink-0 rounded-full ${TONE_RULE[tone]}`} aria-hidden="true" />
      <div className="min-w-0 flex flex-col gap-3">
        {eyebrow && <div className="eyebrow text-gold-ink">{eyebrow}</div>}
        <p className={`serif-diagnosis m-0 ${lead ? "serif-diagnosis-lead" : ""}`}>{children}</p>
        {support && (
          <p className="text-lead text-slate-base leading-normal max-w-[60ch] m-0">{support}</p>
        )}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}

// GoldUnderlineSweep: a thin gold rule that wipes in once beneath a value to mark
// it as freshly computed. The animation is pure CSS (no library); changing
// sweepKey remounts the rule so the wipe replays exactly once per recompute.
// Reduced motion holds the rule fully drawn. Decorative, so aria-hidden.
export function GoldUnderlineSweep({
  children,
  active = true,
  sweepKey,
}: {
  children: React.ReactNode;
  active?: boolean;
  sweepKey?: string | number;
}) {
  return (
    <span className="gold-sweep">
      {children}
      {active && <span key={sweepKey} className="gold-sweep-line" aria-hidden="true" />}
    </span>
  );
}
