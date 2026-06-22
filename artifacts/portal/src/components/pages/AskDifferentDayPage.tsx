import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ArrowRight, Sparkles } from "lucide-react";
import type { FindingChallenge, OverviewLayer, SignalLayer } from "../../types";
import { fetchOverview, fetchSignals } from "../../lib/tenantApi";
import { fetchChallenges, groupChallengesByRef } from "../../lib/challengeApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { Link } from "../../lib/router";
import { FindingChallengeSlot, type ChallengeContext } from "../layer/sections";
import {
  ConfidencePill,
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  SkeletonLines,
  VerdictPill,
  formatDateTime,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; overview: OverviewLayer[]; signals: SignalLayer[]; challenges: FindingChallenge[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

interface QA {
  key: string;
  name: string;
  question: string;
  narrative: string | null;
  headline: string | null;
  signal: SignalLayer | null;
  generatedAt: string | null;
  generatorModel: string | null;
}

// Build the question-and-answer set from real persisted content. Each generated
// layer contributes its diagnostic question; the answer is assembled from the
// stored narrative, causes, actions and confounders. Nothing is produced live.
function buildQuestions(overview: OverviewLayer[], signals: SignalLayer[]): QA[] {
  const sigByKey = new Map(signals.map((s) => [s.key, s]));
  return overview
    .filter((l) => l.generated)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({
      key: l.key,
      name: l.name,
      question: l.diagnosticQuestion,
      narrative: l.narrative,
      headline: l.headlineFinding,
      signal: sigByKey.get(l.key) ?? null,
      generatedAt: l.generatedAt,
      generatorModel: l.generatorModel,
    }));
}

// Ask Different Day. The question set is every layer's real diagnostic question;
// each answer is assembled from intelligence already generated for the tenant
// (narrative, causes, recommended actions, open confounders) with provenance and
// the generation time. It is explicitly not a live model call: the deferral is
// honest, and the answer always declares it was assembled from saved reasoning.
// The Interactive Challenge (Phase AA) is the one live affordance here: a
// non-viewer seat can object to a specific cause or action and the engine
// re-reasons that finding, recorded as an auditable uphold-or-revise.
export function AskDifferentDayPage() {
  const { user, logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    setOpen(null);
    Promise.all([fetchOverview(currentId), fetchSignals(currentId), fetchChallenges(currentId)]).then(
      ([ovOut, sigOut, chOut]) => {
        if (!alive) return;
        if ("unauthorized" in ovOut || "unauthorized" in sigOut) return void logout();
        if (ovOut.state === "error" || sigOut.state === "error") return setState({ kind: "error" });
        if (ovOut.state === "empty") return setState({ kind: "empty" });
        const signals = sigOut.state === "empty" ? [] : sigOut.items;
        // The challenge overlay is non-critical: a transient failure shows no
        // history rather than blocking the answers.
        const challenges = "unauthorized" in chOut || chOut.state === "error" ? [] : chOut.challenges;
        setState({ kind: "ready", overview: ovOut.items, signals, challenges });
      },
    );
    return () => {
      alive = false;
    };
  }, [currentId, tenantStatus, logout]);

  const questions = useMemo(
    () => (state.kind === "ready" ? buildQuestions(state.overview, state.signals) : []),
    [state],
  );

  const handleChallenged = useCallback((challenge: FindingChallenge) => {
    setState((s) => (s.kind === "ready" ? { ...s, challenges: [challenge, ...s.challenges] } : s));
  }, []);

  // Group every loaded challenge by its layer, then by finding ref, so each
  // question card gets exactly its own findings' history with no per-render
  // re-filtering cost.
  const byLayer = useMemo(() => {
    const out = new Map<string, Map<string, FindingChallenge[]>>();
    if (state.kind !== "ready") return out;
    for (const qa of questions) {
      out.set(qa.key, groupChallengesByRef(state.challenges.filter((c) => c.layerKey === qa.key)));
    }
    return out;
  }, [state, questions]);

  const canChallenge = user?.role !== "client-viewer";

  return (
    <PageWidth space="page">
      <PageHeader
        eyebrow="Ask Different Day"
        title="Answers from what has been reasoned"
        subtitle={current ? `Each answer is assembled from intelligence already generated for ${current.name}, not produced live.` : undefined}
      />
      <div className="mt-7">
        {state.kind === "loading" && <SkeletonLines lines={5} />}
        {state.kind === "error" && (
          <ErrorState message="Ask Different Day could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, you can ask of its intelligence here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState title="Nothing to ask yet" message="No intelligence has been generated for this company, so there is nothing to answer from." />
        )}
        {state.kind === "ready" && questions.length === 0 && (
          <EmptyState title="Nothing to ask yet" message="No layer has been generated, so there are no answers to assemble." />
        )}
        {state.kind === "ready" && questions.length > 0 && currentId && (
          <div className="grid gap-2.5">
            {questions.map((qa) => {
              const challenge: ChallengeContext = {
                tenantId: currentId,
                layerKey: qa.key,
                byRef: byLayer.get(qa.key) ?? new Map(),
                canChallenge,
                onChallenged: handleChallenged,
                onUnauthorized: logout,
              };
              return (
                <QuestionCard
                  key={qa.key}
                  qa={qa}
                  challenge={challenge}
                  open={open === qa.key}
                  onToggle={() => setOpen((k) => (k === qa.key ? null : qa.key))}
                />
              );
            })}
          </div>
        )}
      </div>
    </PageWidth>
  );
}

function QuestionCard({
  qa,
  challenge,
  open,
  onToggle,
}: {
  qa: QA;
  challenge: ChallengeContext;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 py-4 px-5 bg-transparent border-none cursor-pointer text-left"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Sparkles size={15} color="var(--gold)" className="shrink-0" />
          <span className="min-w-0">
            <span className="eyebrow text-slate-light">{qa.name}</span>
            <span className="font-serif block text-[16px] text-navy mt-0.5">
              {qa.question}
            </span>
          </span>
        </span>
        {open ? <ChevronDown size={16} color="var(--slate-light)" /> : <ChevronRight size={16} color="var(--slate-light)" />}
      </button>
      {open && <Answer qa={qa} challenge={challenge} />}
    </div>
  );
}

function Answer({ qa, challenge }: { qa: QA; challenge: ChallengeContext }) {
  const s = qa.signal;
  // slice(0,3) preserves content order, so the index here is the same index the
  // engine uses for the finding ref (causes[i] / actions[i]).
  const causes = (s?.causes ?? []).slice(0, 3);
  const actions = (s?.actions ?? []).slice(0, 3);
  const openConfounders = (s?.confounders ?? [])
    .filter((c) => c.verdict === "partial" || c.verdict === "unresolved")
    .slice(0, 3);
  const lead = qa.narrative || qa.headline;

  return (
    <div className="border-t border-border-base pt-[18px] px-5 pb-5 grid gap-[18px]">
      {lead && <div className="text-[14.5px] text-slate-base leading-relaxed">{lead}</div>}

      {causes.length > 0 && (
        <Block title="What is driving it">
          {causes.map((c, i) => (
            <div key={i} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2.5 flex-wrap">
                <span className="text-[14px] text-navy font-semibold">{c.title ?? "Cause"}</span>
                {c.basis && c.confidence != null && <ConfidencePill basis={c.basis} confidence={c.confidence} />}
              </div>
              {c.impact && <div className="text-caption text-slate-base leading-normal">{c.impact}</div>}
              <FindingChallengeSlot ctx={challenge} findingRef={`causes[${i}]`} />
            </div>
          ))}
        </Block>
      )}

      {actions.length > 0 && (
        <Block title="What to do about it">
          {actions.map((a, i) => (
            <div key={i} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2.5 flex-wrap">
                <span className="text-[14px] text-navy font-semibold">{a.title ?? "Action"}</span>
                {a.basis && a.confidence != null && <ConfidencePill basis={a.basis} confidence={a.confidence} />}
              </div>
              {a.impact && <div className="text-caption text-slate-base leading-normal">{a.impact}</div>}
              <FindingChallengeSlot ctx={challenge} findingRef={`actions[${i}]`} />
            </div>
          ))}
        </Block>
      )}

      {openConfounders.length > 0 && (
        <Block title="What the analysis could not rule out">
          {openConfounders.map((c, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2.5 flex-wrap">
              <span className="text-[13.5px] text-slate-base leading-normal flex-1 min-w-0">
                {c.name ?? "Alternative explanation"}
                {c.reason ? `. ${c.reason}` : ""}
              </span>
              {c.verdict && <VerdictPill verdict={c.verdict} />}
            </div>
          ))}
        </Block>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <span className="text-xs text-slate-light">
          Assembled from saved intelligence
          {qa.generatedAt ? `, generated ${formatDateTime(qa.generatedAt)}` : ""}
          {qa.generatorModel ? ` by ${qa.generatorModel}` : ""}. Not a live query.
        </span>
        <Link
          to={`/layers/${qa.key}`}
          className="btn-ghost no-underline inline-flex items-center gap-1.5"
        >
          Open the layer <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <div className="eyebrow text-slate-light">{title}</div>
      {children}
    </div>
  );
}
