import React, { useEffect, useState } from "react";
import { Check, Copy, Printer, Share2 } from "lucide-react";
import type { MintedShareToken, OverviewLayer, ShareToken } from "../../types";
import { fetchOverview } from "../../lib/tenantApi";
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
  toneColorVar,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; overview: OverviewLayer[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

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
    <PageWidth style={{ paddingTop: 28, paddingBottom: 64 }}>
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
              className="btn-ghost"
              onClick={() => window.print()}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Printer size={14} /> Print
            </button>
          ) : undefined
        }
      />

      {isProvider && currentId && <ShareLinks tenantId={currentId} />}

      <div style={{ marginTop: 28 }}>
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
          <div style={{ display: "grid", gap: 16 }}>
            {generated.map((l) => (
              <BoardEntry key={l.key} layer={l} />
            ))}
          </div>
        )}
      </div>
    </PageWidth>
  );
}

function BoardEntry({ layer }: { layer: OverviewLayer }) {
  const tone = layer.hero?.tone ?? layer.leadMetric?.tone ?? "neutral";
  const metricValue = layer.hero?.metricValue ?? layer.leadMetric?.value;
  const metricLabel = layer.hero?.metricLabel ?? layer.leadMetric?.label;

  return (
    <section className="card" style={{ padding: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Link to={`/layers/${layer.key}`} style={{ textDecoration: "none" }}>
          <h2 className="font-serif" style={{ fontSize: 19, fontWeight: 700, color: "var(--navy)", margin: 0 }}>
            {layer.name}
          </h2>
        </Link>
        <Tag kind="model">{layer.archetype}</Tag>
      </div>

      <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
        {metricValue && (
          <div style={{ flexShrink: 0 }}>
            <div className="font-mono" style={{ fontSize: 26, fontWeight: 500, color: toneColorVar[tone], lineHeight: 1 }}>
              {metricValue}
            </div>
            {metricLabel && (
              <div className="eyebrow" style={{ color: "var(--slate-light)", marginTop: 6 }}>
                {metricLabel}
              </div>
            )}
          </div>
        )}
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          {layer.headlineFinding && (
            <div className="font-serif" style={{ fontSize: 16, color: "var(--navy)", lineHeight: 1.45 }}>
              {layer.headlineFinding}
            </div>
          )}
          {layer.narrative && (
            <p style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6, margin: "10px 0 0" }}>
              {layer.narrative}
            </p>
          )}
        </div>
      </div>

      {layer.topAction && (layer.topAction.title || layer.topAction.impact) && (
        <div style={{ marginTop: 16, borderLeft: "3px solid var(--teal)", paddingLeft: 14 }}>
          <div className="eyebrow" style={{ color: "var(--slate-light)", marginBottom: 4 }}>
            Recommended move
          </div>
          {layer.topAction.title && (
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>{layer.topAction.title}</div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
            {layer.topAction.impact && (
              <span style={{ fontSize: 13, color: "var(--slate)" }}>{layer.topAction.impact}</span>
            )}
            {layer.topAction.basis && (
              <span className={`pill ${basisPillClass(layer.topAction.basis)}`}>{basisLabel(layer.topAction.basis)}</span>
            )}
            {layer.topAction.confidence != null && (
              <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
                {pct(layer.topAction.confidence)} confidence
              </span>
            )}
          </div>
        </div>
      )}

      {layer.topGap && layer.topGap.description && (
        <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span className="eyebrow" style={{ color: "var(--amber-ink)" }}>
            Still unknown
          </span>
          <span style={{ fontSize: 13, color: "var(--slate)" }}>
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
    <section className="card" style={{ padding: 22, marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--slate-light)" }}>
            Share
          </div>
          <div className="font-serif" style={{ fontSize: 16, color: "var(--navy)", marginTop: 2 }}>
            Read-only diagnosis link
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={onMint}
          disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Share2 size={14} /> Create link
        </button>
      </div>

      <p style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.6, margin: "10px 0 0" }}>
        A shared link shows a board-pack summary only, with no login, no raw data, and no
        provenance. It carries the Powered by Elevated Intelligence mark and expires
        automatically.
      </p>

      {actionError && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--coral-ink)" }}>
          The link action did not complete ({actionError}).
        </div>
      )}

      {minted && shareUrl && (
        <div
          style={{
            marginTop: 14,
            border: "1px solid var(--cream-dark)",
            borderRadius: 8,
            padding: 14,
            background: "var(--cream-light)",
          }}
        >
          <div className="eyebrow" style={{ color: "var(--teal-ink)", marginBottom: 6 }}>
            New link, copy it now
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code
              className="font-mono"
              style={{ fontSize: 12.5, color: "var(--navy)", wordBreak: "break-all", flex: "1 1 280px" }}
            >
              {shareUrl}
            </code>
            <button
              className="btn-ghost"
              onClick={onCopy}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
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
          <div style={{ fontSize: 12, color: "var(--slate-light)", marginTop: 8 }}>
            This full link is shown once and cannot be retrieved later. Expires{" "}
            {formatDate(minted.expiresAt)}.
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {loadError && (
          <div style={{ fontSize: 13, color: "var(--coral-ink)" }}>
            The existing links could not be loaded.
          </div>
        )}
        {!loadError && shares && shares.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--slate-light)" }}>No links yet.</div>
        )}
        {!loadError && shares && shares.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {shares.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  borderTop: "1px solid var(--cream-dark)",
                  paddingTop: 8,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill color={s.status === "active" ? "teal" : s.status === "revoked" ? "coral" : "gray"}>
                    {s.status}
                  </Pill>
                  <span style={{ fontSize: 13, color: "var(--slate)" }}>{s.label ?? "Untitled link"}</span>
                  <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
                    {s.accessCount} {s.accessCount === 1 ? "view" : "views"}, expires {formatDate(s.expiresAt)}
                  </span>
                </div>
                {s.status === "active" && (
                  <button
                    className="btn-ghost"
                    onClick={() => onRevoke(s.id)}
                    disabled={busy}
                    style={{ fontSize: 12.5 }}
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
