import React, { useEffect, useState } from "react";
import { Check, Play, X, RotateCcw } from "lucide-react";
import type { CommittedAction, SignalAction, SignalLayer } from "../../types";
import { commitAction, fetchActions, fetchSignals, setActionStatus } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { Link } from "../../lib/router";
import {
  ConfidencePill,
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  Pill,
  SectionHeading,
  SkeletonLines,
  VerdictPill,
  formatDate,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; signals: SignalLayer[]; actions: CommittedAction[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

const STATUS_META: Record<CommittedAction["status"], { color: "navy" | "amber" | "teal" | "gray"; label: string }> = {
  committed: { color: "navy", label: "Committed" },
  in_progress: { color: "amber", label: "In progress" },
  done: { color: "teal", label: "Done" },
  dismissed: { color: "gray", label: "Dismissed" },
};

interface RecommendedMove {
  layerKey: string;
  layerName: string;
  action: SignalAction;
}

function committedKey(layerKey: string, title: string | null): string {
  return `${layerKey}::${title ?? ""}`;
}

// The war room. A read-only synthesis of the decision picture across every
// generated layer: the questions the analysis could not close (confounders), the
// leading hypotheses, and the moves the cortex recommends. Recommended moves can
// be committed (only when they carry a real basis and confidence, never a
// fabricated one); committed moves can be advanced through their lifecycle.
// Interactive what-if simulation is deferred on purpose: its numbers would be
// invented, which this product does not do.
export function WarRoomPage() {
  const { user, logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  // A client-viewer is a read-only seat: it reads the decision picture but never
  // commits or advances a move. The server enforces this; the UI must not offer
  // an affordance that would only fail with a 403.
  const canAct = user?.role !== "client-viewer";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    setActionError(null);
    Promise.all([fetchSignals(currentId), fetchActions(currentId)]).then(([sigOut, actOut]) => {
      if (!alive) return;
      if ("unauthorized" in sigOut || "unauthorized" in actOut) return void logout();
      if (sigOut.state === "error" || actOut.state === "error") return setState({ kind: "error" });
      if (sigOut.state === "empty") return setState({ kind: "empty" });
      const actions = actOut.state === "empty" ? [] : actOut.items;
      setState({ kind: "ready", signals: sigOut.items, actions });
    });
    return () => {
      alive = false;
    };
  }, [currentId, tenantStatus, logout]);

  function mark(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function reloadActions() {
    if (!currentId) return;
    const out = await fetchActions(currentId);
    if ("unauthorized" in out) return void logout();
    if (out.state === "error") return;
    setState((s) => (s.kind === "ready" ? { ...s, actions: out.state === "empty" ? [] : out.items } : s));
  }

  async function onCommit(move: RecommendedMove) {
    if (!currentId || move.action.basis == null || move.action.confidence == null || !move.action.title) return;
    const id = committedKey(move.layerKey, move.action.title);
    mark(id, true);
    setActionError(null);
    const out = await commitAction(currentId, {
      layerKey: move.layerKey,
      title: move.action.title,
      predictedImpact: move.action.impact ?? undefined,
      timing: move.action.timing ?? undefined,
      owner: move.action.owner ?? undefined,
      basis: move.action.basis,
      confidence: move.action.confidence,
    });
    if ("unauthorized" in out) return void logout();
    if ("error" in out) setActionError("That move could not be committed. Please try again.");
    else await reloadActions();
    mark(id, false);
  }

  async function onStatus(action: CommittedAction, status: CommittedAction["status"]) {
    if (!currentId) return;
    mark(action.id, true);
    setActionError(null);
    const out = await setActionStatus(currentId, action.id, status);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) setActionError("That status change could not be saved. Please try again.");
    else await reloadActions();
    mark(action.id, false);
  }

  const generated = state.kind === "ready" ? state.signals.filter((s) => s.generated) : [];
  const committedSet =
    state.kind === "ready" ? new Set(state.actions.map((a) => committedKey(a.layerKey, a.title))) : new Set<string>();

  const openConfounders =
    state.kind === "ready"
      ? generated
          .flatMap((s) => s.confounders.map((c) => ({ layer: s, c })))
          .filter(({ c }) => c.verdict === "partial" || c.verdict === "unresolved")
          .sort((a, b) => verdictRank(a.c.verdict) - verdictRank(b.c.verdict) || (a.c.rank ?? 99) - (b.c.rank ?? 99))
      : [];

  const hypotheses =
    state.kind === "ready"
      ? generated
          .flatMap((s) => s.hypotheses.map((h) => ({ layer: s, h })))
          .filter(({ h }) => h.statement)
          .sort((a, b) => (b.h.confidence ?? 0) - (a.h.confidence ?? 0))
          .slice(0, 6)
      : [];

  const moves: RecommendedMove[] =
    state.kind === "ready"
      ? generated
          .flatMap((s) => s.actions.map((a) => ({ layerKey: s.key, layerName: s.name, action: a })))
          .filter((m) => m.action.title && !committedSet.has(committedKey(m.layerKey, m.action.title)))
      : [];

  const committed = state.kind === "ready" ? state.actions : [];
  const isEmpty = state.kind === "ready" && generated.length === 0 && committed.length === 0;

  return (
    <PageWidth space="page">
      <PageHeader
        eyebrow="War room"
        title="The decision picture"
        subtitle={current ? `Open questions, leading hypotheses and the moves on the table for ${current.name}.` : undefined}
      />
      <div className="mt-7 grid gap-9">
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The war room could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its decision picture will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState title="No intelligence generated yet" message="Once the pipeline runs, the decision picture will assemble here." />
        )}
        {isEmpty && (
          <EmptyState title="Nothing on the table yet" message="No layer has been generated and nothing has been committed." />
        )}

        {state.kind === "ready" && !isEmpty && (
          <>
            {actionError && <div className="alert-error">{actionError}</div>}

            <section>
              <SectionHeading eyebrow="Open questions" title="What the analysis could not close" />
              {openConfounders.length === 0 ? (
                <EmptyState title="Nothing open" message="Every confounder across the generated layers was ruled out." />
              ) : (
                <div className="grid gap-2.5">
                  {openConfounders.map(({ layer, c }, i) => (
                    <div key={`${layer.key}-${i}`} className="card grid gap-1.5">
                      <div className="flex items-baseline justify-between gap-2.5 flex-wrap">
                        <span className="font-serif text-body text-navy">{c.name ?? "Alternative explanation"}</span>
                        {c.verdict && <VerdictPill verdict={c.verdict} />}
                      </div>
                      {(c.reason || c.mechanism) && (
                        <div className="text-[13.5px] text-slate-base leading-normal">{c.reason || c.mechanism}</div>
                      )}
                      <LayerTag layer={layer} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {hypotheses.length > 0 && (
              <section>
                <SectionHeading eyebrow="Leading hypotheses" title="The best current explanations" />
                <div className="grid gap-2.5">
                  {hypotheses.map(({ layer, h }, i) => (
                    <div key={`${layer.key}-${i}`} className="card grid gap-1.5">
                      <div className="flex items-baseline justify-between gap-2.5 flex-wrap">
                        <span className="text-[14.5px] text-navy leading-normal flex-1 min-w-0">{h.statement}</span>
                        {h.basis && h.confidence != null && <ConfidencePill basis={h.basis} confidence={h.confidence} />}
                      </div>
                      <LayerTag layer={layer} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <SectionHeading eyebrow="Moves on the table" title="Recommended actions, not yet committed" />
              {moves.length === 0 ? (
                <EmptyState title="No open moves" message="Every recommended action has already been committed." />
              ) : (
                <div className="grid gap-2.5">
                  {moves.map((m, i) => (
                    <MoveCard
                      key={`${m.layerKey}-${i}`}
                      move={m}
                      canAct={canAct}
                      busy={busy.has(committedKey(m.layerKey, m.action.title))}
                      onCommit={() => onCommit(m)}
                    />
                  ))}
                </div>
              )}
            </section>

            {committed.length > 0 && (
              <section>
                <SectionHeading eyebrow="Committed" title="Moves made, and where they stand" />
                <div className="grid gap-2.5">
                  {committed.map((a) => (
                    <CommittedCard
                      key={a.id}
                      action={a}
                      canAct={canAct}
                      busy={busy.has(a.id)}
                      onStatus={(s) => onStatus(a, s)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PageWidth>
  );
}

function verdictRank(v: SignalLayer["confounders"][number]["verdict"]): number {
  return v === "unresolved" ? 0 : v === "partial" ? 1 : 2;
}

function LayerTag({ layer }: { layer: SignalLayer }) {
  return (
    <Link to={`/layers/${layer.key}`} className="eyebrow text-slate-light no-underline">
      {layer.name}
    </Link>
  );
}

function MoveCard({
  move,
  canAct,
  busy,
  onCommit,
}: {
  move: RecommendedMove;
  canAct: boolean;
  busy: boolean;
  onCommit: () => void;
}) {
  const a = move.action;
  const committable = Boolean(a.title) && a.basis != null && a.confidence != null;
  return (
    <div className="card grid gap-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-serif text-[16px] text-navy">{a.title}</span>
        {a.basis != null && a.confidence != null && <ConfidencePill basis={a.basis} confidence={a.confidence} />}
      </div>
      {a.impact && <div className="text-[13.5px] text-slate-base leading-normal">{a.impact}</div>}
      <div className="flex items-center justify-between gap-3 flex-wrap mt-0.5">
        <div className="flex gap-3.5 flex-wrap text-xs text-slate-light">
          <Link to={`/layers/${move.layerKey}`} className="text-slate-light no-underline">{move.layerName}</Link>
          {a.timing && <span>Timing: {a.timing}</span>}
          {a.owner && <span>Owner: {a.owner}</span>}
        </div>
        {!canAct ? (
          <span className="eyebrow text-slate-light">Read-only access</span>
        ) : committable ? (
          <button className="btn-primary" onClick={onCommit} disabled={busy}>
            {busy ? "Committing" : "Commit move"}
          </button>
        ) : (
          <span className="eyebrow text-slate-light">No confidence recorded, cannot commit</span>
        )}
      </div>
    </div>
  );
}

function CommittedCard({
  action,
  canAct,
  busy,
  onStatus,
}: {
  action: CommittedAction;
  canAct: boolean;
  busy: boolean;
  onStatus: (status: CommittedAction["status"]) => void;
}) {
  const meta = STATUS_META[action.status];
  return (
    <div className="card grid gap-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-serif text-[16px] text-navy">{action.title}</span>
        <Pill color={meta.color}>{meta.label}</Pill>
      </div>
      {action.predictedImpact && (
        <div className="text-caption text-slate-base leading-normal">Predicted: {action.predictedImpact}</div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap mt-0.5">
        <div className="flex gap-3.5 flex-wrap text-xs text-slate-light items-center">
          <Link to={`/layers/${action.layerKey}`} className="text-slate-light no-underline">{action.layerKey}</Link>
          <span>Committed {formatDate(action.committedAt)}</span>
          <ConfidencePill basis={action.basis} confidence={action.confidence} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {canAct ? (
            <StatusControls status={action.status} busy={busy} onStatus={onStatus} />
          ) : (
            <span className="eyebrow text-slate-light">Read-only access</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusControls({
  status,
  busy,
  onStatus,
}: {
  status: CommittedAction["status"];
  busy: boolean;
  onStatus: (status: CommittedAction["status"]) => void;
}) {
  if (status === "committed") {
    return (
      <>
        <button className="btn-primary" onClick={() => onStatus("in_progress")} disabled={busy}>
          <Play size={13} /> Start
        </button>
        <button className="btn-ghost" onClick={() => onStatus("dismissed")} disabled={busy}>
          <X size={13} /> Dismiss
        </button>
      </>
    );
  }
  if (status === "in_progress") {
    return (
      <>
        <button className="btn-primary" onClick={() => onStatus("done")} disabled={busy}>
          <Check size={13} /> Mark done
        </button>
        <button className="btn-ghost" onClick={() => onStatus("dismissed")} disabled={busy}>
          <X size={13} /> Dismiss
        </button>
      </>
    );
  }
  // done or dismissed: allow reopening to the committed state.
  return (
    <button className="btn-ghost" onClick={() => onStatus("committed")} disabled={busy}>
      <RotateCcw size={13} /> Reopen
    </button>
  );
}
