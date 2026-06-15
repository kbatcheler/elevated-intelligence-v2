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
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Ask Different Day"
        title="Answers from what has been reasoned"
        subtitle={current ? `Each answer is assembled from intelligence already generated for ${current.name}, not produced live.` : undefined}
      />
      <div style={{ marginTop: 28 }}>
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
          <div style={{ display: "grid", gap: 10 }}>
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
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Sparkles size={15} color="var(--gold)" style={{ flexShrink: 0 }} />
          <span style={{ minWidth: 0 }}>
            <span className="eyebrow" style={{ color: "var(--slate-light)" }}>{qa.name}</span>
            <span className="font-serif" style={{ display: "block", fontSize: 16, color: "var(--navy)", marginTop: 2 }}>
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
    <div style={{ borderTop: "1px solid var(--border)", padding: "18px 20px 20px", display: "grid", gap: 18 }}>
      {lead && <div style={{ fontSize: 14.5, color: "var(--slate)", lineHeight: 1.6 }}>{lead}</div>}

      {causes.length > 0 && (
        <Block title="What is driving it">
          {causes.map((c, i) => (
            <div key={i} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, color: "var(--navy)", fontWeight: 600 }}>{c.title ?? "Cause"}</span>
                {c.basis && c.confidence != null && <ConfidencePill basis={c.basis} confidence={c.confidence} />}
              </div>
              {c.impact && <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>{c.impact}</div>}
              <FindingChallengeSlot ctx={challenge} findingRef={`causes[${i}]`} />
            </div>
          ))}
        </Block>
      )}

      {actions.length > 0 && (
        <Block title="What to do about it">
          {actions.map((a, i) => (
            <div key={i} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, color: "var(--navy)", fontWeight: 600 }}>{a.title ?? "Action"}</span>
                {a.basis && a.confidence != null && <ConfidencePill basis={a.basis} confidence={a.confidence} />}
              </div>
              {a.impact && <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>{a.impact}</div>}
              <FindingChallengeSlot ctx={challenge} findingRef={`actions[${i}]`} />
            </div>
          ))}
        </Block>
      )}

      {openConfounders.length > 0 && (
        <Block title="What the analysis could not rule out">
          {openConfounders.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.5, flex: 1, minWidth: 0 }}>
                {c.name ?? "Alternative explanation"}
                {c.reason ? `. ${c.reason}` : ""}
              </span>
              {c.verdict && <VerdictPill verdict={c.verdict} />}
            </div>
          ))}
        </Block>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 4 }}>
        <span style={{ fontSize: 12, color: "var(--slate-light)" }}>
          Assembled from saved intelligence
          {qa.generatedAt ? `, generated ${formatDateTime(qa.generatedAt)}` : ""}
          {qa.generatorModel ? ` by ${qa.generatorModel}` : ""}. Not a live query.
        </span>
        <Link
          to={`/layers/${qa.key}`}
          className="btn-ghost"
          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          Open the layer <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="eyebrow" style={{ color: "var(--slate-light)" }}>{title}</div>
      {children}
    </div>
  );
}
