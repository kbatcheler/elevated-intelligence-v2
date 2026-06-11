import React, { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { OverviewLayer } from "../../types";
import { fetchOverview } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { orderByPerspective, PERSPECTIVE_LABEL } from "../../lib/perspective";
import { Link } from "../../lib/router";
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
  const { logout } = useAuth();
  const { current, currentId, status: tenantStatus, perspective } = useTenant();
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
          <span className="eyebrow" style={{ color: "var(--amber)" }}>
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
