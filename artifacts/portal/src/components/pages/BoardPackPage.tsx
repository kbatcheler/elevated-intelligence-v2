import React, { useEffect, useState } from "react";
import { Check, Copy, Printer, Share2 } from "lucide-react";
import type { MintedShareToken, OverviewLayer, ShareToken, TenantEfficacy, Tone } from "../../types";
import { fetchOverview } from "../../lib/tenantApi";
import { fetchTenantEfficacy } from "../../lib/efficacyApi";
import { fetchShareTokens, mintShareToken, revokeShareToken } from "../../lib/sellabilityApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { orderByPerspective, PERSPECTIVE_LABEL } from "../../lib/perspective";
import { Link, withBase } from "../../lib/router";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  Pill,
  SkeletonLines,
  Tag,
  basisLabel,
  basisPillClass,
  formatDate,
  pct,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; overview: OverviewLayer[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

// Data-driven tone routed through the token scale, never an inline colour. The
// strong (non-ink) variant suits the large leading display figure.
const TONE_TEXT: Record<Tone, string> = {
  good: "text-teal",
  warn: "text-amber-base",
  bad: "text-coral",
  neutral: "text-navy",
};

// The Board Pack. A board-ready compilation of the real per-tenant intelligence:
// per layer, the finding, the leading figure, the narrative, the recommended
// move with its predicted impact and confidence, and the honest blind spot that
// remains. Nothing is summarized by a model here; the page assembles persisted
// fields in the active perspective order and is print-ready.
export function BoardPackPage() {
  const { user, logout } = useAuth();
  const { current, currentId, status: tenantStatus, perspective } = useTenant();
  const isProvider = user?.role === "provider-owner" || user?.role === "provider-member";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    fetchOverview(currentId).then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "error") return setState({ kind: "error" });
      if (out.state === "empty") return setState({ kind: "empty" });
      setState({ kind: "ready", overview: out.items });
    });
    return () => {
      alive = false;
    };
  }, [currentId, tenantStatus, logout]);

  const ordered = state.kind === "ready" ? orderByPerspective(state.overview, perspective) : [];
  const generated = ordered.filter((l) => l.generated);
  const model = generated.map((l) => l.generatorModel).find(Boolean);
  const lastGenerated = generated
    .map((l) => l.generatedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  return (
    <PageWidth space="wide">
      <PageHeader
        eyebrow="Board pack"
        title={current ? current.name : "Board pack"}
        subtitle={
          generated.length > 0
            ? `${generated.length} layers, ${PERSPECTIVE_LABEL[perspective].toLowerCase()} order. Generated ${formatDate(lastGenerated)}${model ? " by " + model : ""}.`
            : current
              ? "Prepared from the latest intelligence run."
              : undefined
        }
        actions={
          generated.length > 0 ? (
            <button
              className="btn-ghost inline-flex items-center gap-1.5"
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print
            </button>
          ) : undefined
        }
      />

      {isProvider && currentId && <ShareLinks tenantId={currentId} />}

      {currentId && state.kind === "ready" && generated.length > 0 && (
        <BoardEfficacy tenantId={currentId} />
      )}

      <div className="mt-7">
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The board pack could not be assembled." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No company in your scope yet"
            message="Once a company is bound to your organization, its board pack will assemble here."
          />
        )}
        {(state.kind === "empty" || (state.kind === "ready" && generated.length === 0)) && (
          <EmptyState
            title="No intelligence generated yet"
            message="No layer content has been generated for this company, so there is nothing to compile."
          />
        )}
        {state.kind === "ready" && generated.length > 0 && (
          <div className="grid gap-4">
            {generated.map((l) => (
              <BoardEntry key={l.key} layer={l} />
            ))}
          </div>
        )}
      </div>
    </PageWidth>
  );
}

// Phase AK: the tenant-level Data Efficacy rollup on the Board Pack. The headline
// is the mean of the generated layers' indices (how good the fuel behind this
// company's diagnosis was), distinct from confidence (how sure the reasoning is).
// A tenant with no generated layer rolls up to a dash, never a fabricated zero;
// outside-in mode states its structurally lower ceiling honestly. Self-fetching,
// mirroring ShareLinks, so the main assembly stays thin, with distinct loading,
// ready, empty, and error states rather than a silently hidden or fabricated
// figure.
function BoardEfficacy({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; data: TenantEfficacy } | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetchTenantEfficacy(tenantId).then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      setState(out.state === "ready" ? { status: "ready", data: out.data } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [tenantId, logout]);

  const frameClass = "card p-[18px] mt-5 flex items-baseline gap-3.5 flex-wrap";
  if (state.status === "loading") {
    return (
      <section className={frameClass}>
        <span className="eyebrow text-slate-light">
          Data efficacy
        </span>
        <span className="font-mono text-slate-light">
          Loading...
        </span>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className={frameClass}>
        <span className="eyebrow text-slate-light">
          Data efficacy
        </span>
        <span className="font-mono text-slate-light">
          Efficacy unavailable right now
        </span>
      </section>
    );
  }

  const { rollup } = state.data;
  const capped = state.data.modeCeiling < 100;

  return (
    <section className={frameClass}>
      <span className="eyebrow text-slate-light">
        Data efficacy
      </span>
      {rollup.score == null ? (
        <span className="font-mono text-slate-light">
          - (no generated layer to score)
        </span>
      ) : (
        <>
          <span className="font-mono text-section font-semibold text-navy">
            {rollup.score}
          </span>
          <span className="text-slate-base">/ 100</span>
          <span className="text-caption text-slate-light">
            mean across {rollup.n} generated layer{rollup.n === 1 ? "" : "s"}
          </span>
        </>
      )}
      {capped && (
        <span
          title="Outside-in mode: the connector-grounded drivers (coverage, freshness) are structurally zero, so the index cannot reach 100. Connect data to raise the ceiling."
          className="text-caption text-slate-light"
        >
          ceiling {state.data.modeCeiling} (outside-in)
        </span>
      )}
    </section>
  );
}

function BoardEntry({ layer }: { layer: OverviewLayer }) {
  const tone = layer.hero?.tone ?? layer.leadMetric?.tone ?? "neutral";
  const metricValue = layer.hero?.metricValue ?? layer.leadMetric?.value;
  const metricLabel = layer.hero?.metricLabel ?? layer.leadMetric?.label;

  return (
    <section className="card p-[22px]">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <Link to={`/layers/${layer.key}`} className="no-underline">
          <h2 className="font-serif text-[19px] font-bold text-navy m-0">
            {layer.name}
          </h2>
        </Link>
        <Tag kind="model">{layer.archetype}</Tag>
      </div>

      <div className="flex gap-5 mt-3.5 flex-wrap">
        {metricValue && (
          <div className="shrink-0">
            <div className={`font-mono text-[26px] font-medium leading-none ${TONE_TEXT[tone]}`}>
              {metricValue}
            </div>
            {metricLabel && (
              <div className="eyebrow text-slate-light mt-1.5">
                {metricLabel}
              </div>
            )}
          </div>
        )}
        <div className="flex-[1_1_320px] min-w-0">
          {layer.headlineFinding && (
            <div className="font-serif text-[16px] text-navy leading-normal">
              {layer.headlineFinding}
            </div>
          )}
          {layer.narrative && (
            <p className="text-[13.5px] text-slate-base leading-relaxed mt-2.5">
              {layer.narrative}
            </p>
          )}
        </div>
      </div>

      {layer.topAction && (layer.topAction.title || layer.topAction.impact) && (
        <div className="mt-4 border-l-[3px] border-teal pl-3.5">
          <div className="eyebrow text-slate-light mb-1">
            Recommended move
          </div>
          {layer.topAction.title && (
            <div className="text-[14px] font-semibold text-navy">{layer.topAction.title}</div>
          )}
          <div className="flex gap-2.5 items-center flex-wrap mt-1.5">
            {layer.topAction.impact && (
              <span className="text-caption text-slate-base">{layer.topAction.impact}</span>
            )}
            {layer.topAction.basis && (
              <span className={`pill ${basisPillClass(layer.topAction.basis)}`}>{basisLabel(layer.topAction.basis)}</span>
            )}
            {layer.topAction.confidence != null && (
              <span className="eyebrow text-slate-light">
                {pct(layer.topAction.confidence)} confidence
              </span>
            )}
          </div>
        </div>
      )}

      {layer.topGap && layer.topGap.description && (
        <div className="mt-3.5 flex gap-2 items-baseline flex-wrap">
          <span className="eyebrow text-amber-ink">
            Still unknown
          </span>
          <span className="text-caption text-slate-base">
            {layer.topGap.description}
            {layer.topGap.closes ? ` Closed by ${layer.topGap.closes}.` : ""}
          </span>
          {layer.topGap.confidenceLiftPp != null && (
            <Pill color="amber">+{layer.topGap.confidenceLiftPp}pp if closed</Pill>
          )}
        </div>
      )}
    </section>
  );
}

// The provider-only Share panel. A board pack can be turned into a read-only,
// summary-only link for a prospect: minting returns the plaintext token exactly
// ONCE, so the full URL is shown here for the operator to copy and is never
// retrievable again. Existing links are metadata only (status, expiry, real
// access count) with an early revoke. The viral "powered by" mark travels on the
// shared diagnosis itself; this panel states that so the operator knows it.
function ShareLinks({ tenantId }: { tenantId: string }) {
  const [shares, setShares] = useState<ShareToken[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [minted, setMinted] = useState<MintedShareToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setShares(null);
    setMinted(null);
    setActionError(null);
    setLoadError(false);
    fetchShareTokens(tenantId).then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return;
      if (out.state === "error") return setLoadError(true);
      setShares(out.shares);
    });
    return () => {
      alive = false;
    };
  }, [tenantId]);

  async function reload() {
    const out = await fetchShareTokens(tenantId);
    if ("unauthorized" in out) return;
    if (out.state === "error") return setLoadError(true);
    setLoadError(false);
    setShares(out.shares);
  }

  async function onMint() {
    setBusy(true);
    setActionError(null);
    const out = await mintShareToken(tenantId, {});
    setBusy(false);
    if ("unauthorized" in out) return;
    if ("error" in out) return setActionError(out.error);
    setMinted(out.share);
    setCopied(false);
    void reload();
  }

  async function onRevoke(id: string) {
    setBusy(true);
    setActionError(null);
    const out = await revokeShareToken(tenantId, id);
    setBusy(false);
    if ("unauthorized" in out) return;
    if ("error" in out) return setActionError(out.error);
    if (minted && minted.id === id) setMinted(null);
    void reload();
  }

  const shareUrl = minted ? window.location.origin + withBase(minted.diagnosisPath) : null;

  async function onCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card p-[22px] mt-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow text-slate-light">
            Share
          </div>
          <div className="font-serif text-[16px] text-navy mt-0.5">
            Read-only diagnosis link
          </div>
        </div>
        <button
          className="btn-primary inline-flex items-center gap-1.5"
          onClick={onMint}
          disabled={busy}
        >
          <Share2 size={14} /> Create link
        </button>
      </div>

      <p className="text-caption text-slate-base leading-relaxed mt-2.5">
        A shared link shows a board-pack summary only, with no login, no raw data, and no
        provenance. It carries the Powered by Elevated Intelligence mark and expires
        automatically.
      </p>

      {actionError && (
        <div className="mt-3 text-caption text-coral-ink">
          The link action did not complete ({actionError}).
        </div>
      )}

      {minted && shareUrl && (
        <div className="mt-3.5 border border-cream-dark rounded-lg p-3.5 bg-cream-light">
          <div className="eyebrow text-teal-ink mb-1.5">
            New link, copy it now
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <code
              className="font-mono text-[12.5px] text-navy break-all flex-[1_1_280px]"
            >
              {shareUrl}
            </code>
            <button
              className="btn-ghost inline-flex items-center gap-1.5"
              onClick={onCopy}
            >
              {copied ? (
                <>
                  <Check size={14} /> Copied
                </>
              ) : (
                <>
                  <Copy size={14} /> Copy
                </>
              )}
            </button>
          </div>
          <div className="text-xs text-slate-light mt-2">
            This full link is shown once and cannot be retrieved later. Expires{" "}
            {formatDate(minted.expiresAt)}.
          </div>
        </div>
      )}

      <div className="mt-4">
        {loadError && (
          <div className="text-caption text-coral-ink">
            The existing links could not be loaded.
          </div>
        )}
        {!loadError && shares && shares.length === 0 && (
          <div className="text-caption text-slate-light">No links yet.</div>
        )}
        {!loadError && shares && shares.length > 0 && (
          <div className="grid gap-2">
            {shares.map((s) => (
              <div
                key={s.id}
                className="flex gap-2.5 items-center justify-between flex-wrap border-t border-cream-dark pt-2"
              >
                <div className="flex gap-2 items-center flex-wrap">
                  <Pill color={s.status === "active" ? "teal" : s.status === "revoked" ? "coral" : "gray"}>
                    {s.status}
                  </Pill>
                  <span className="text-caption text-slate-base">{s.label ?? "Untitled link"}</span>
                  <span className="eyebrow text-slate-light">
                    {s.accessCount} {s.accessCount === 1 ? "view" : "views"}, expires {formatDate(s.expiresAt)}
                  </span>
                </div>
                {s.status === "active" && (
                  <button
                    className="btn-ghost text-[12.5px]"
                    onClick={() => onRevoke(s.id)}
                    disabled={busy}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
