import React, { useEffect, useState } from "react";
import { ArrowRight, FileText } from "lucide-react";
import type { OverviewLayer, Tone } from "../../types";
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
  SectionHeading,
  SkeletonLines,
  Tag,
  formatDate,
  toneColorVar,
  toneInkVar,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; overview: OverviewLayer[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

// The Morning Brief. The home surface, assembled from the real per-tenant
// overview. The active perspective lens re-ranks which layers lead; from any
// lead the diagnosis is one click away on the layer page. Every figure here is a
// persisted field, and layers the cortex has not generated say so plainly.
export function BriefPage() {
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
  const leads = generated.slice(0, 3);
  const lastGenerated = generated
    .map((l) => l.generatedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Morning brief"
        title={current ? current.name : "Morning brief"}
        subtitle={current ? current.tagline || current.sector || current.url : undefined}
        actions={
          lastGenerated ? (
            <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
              {PERSPECTIVE_LABEL[perspective]} lens &middot; generated {formatDate(lastGenerated)}
            </span>
          ) : undefined
        }
      />

      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The brief could not be assembled." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No company in your scope yet"
            message="Once a company is bound to your organization, its morning brief will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState
            title="No intelligence generated yet"
            message="No layers have been generated for this company. Once the pipeline runs, the brief will assemble from its output."
          />
        )}
        {state.kind === "ready" && generated.length === 0 && (
          <EmptyState
            title="No intelligence generated yet"
            message="The registry is in place but no layer content has been generated for this company."
          />
        )}
        {state.kind === "ready" && generated.length > 0 && (
          <>
            <SectionHeading eyebrow="Lead with this" title="What to look at first" />
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              }}
            >
              {leads.map((l) => (
                <LeadCard key={l.key} layer={l} />
              ))}
            </div>

            <div style={{ marginTop: 40 }}>
              <SectionHeading
                eyebrow="Every layer"
                title="The full picture"
                action={
                  <Link
                    to="/board"
                    className="btn-ghost"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <FileText size={14} /> Board pack
                  </Link>
                }
              />
              <div style={{ display: "grid", gap: 8 }}>
                {ordered.map((l) => (
                  <LayerRow key={l.key} layer={l} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </PageWidth>
  );
}

// The single number that leads a layer: its hero metric when present, otherwise
// the first content metric. Never computed, only chosen.
function leadFigure(l: OverviewLayer): { value: string | null; label: string | null; tone: Tone } {
  if (l.hero && l.hero.metricValue) {
    return { value: l.hero.metricValue, label: l.hero.metricLabel, tone: l.hero.tone ?? "neutral" };
  }
  if (l.leadMetric) {
    return { value: l.leadMetric.value, label: l.leadMetric.label, tone: l.leadMetric.tone ?? "neutral" };
  }
  return { value: null, label: null, tone: "neutral" };
}

function LeadCard({ layer }: { layer: OverviewLayer }) {
  const fig = leadFigure(layer);
  const read = layer.hero?.oneLineRead || layer.headlineImpact;
  return (
    <Link to={`/layers/${layer.key}`} style={{ textDecoration: "none", minWidth: 0 }}>
      <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span className="font-serif" style={{ fontSize: 17, color: "var(--navy)" }}>
            {layer.name}
          </span>
          <ArrowRight size={16} color="var(--gold)" style={{ flexShrink: 0 }} />
        </div>
        {fig.value && (
          <div>
            <div className="font-mono" style={{ fontSize: 30, fontWeight: 500, color: toneColorVar[fig.tone], lineHeight: 1, overflowWrap: "anywhere" }}>
              {fig.value}
            </div>
            {fig.label && (
              <div className="eyebrow" style={{ color: "var(--slate-light)", marginTop: 6 }}>
                {fig.label}
              </div>
            )}
          </div>
        )}
        {layer.headlineFinding && (
          <div style={{ fontSize: 14, color: "var(--navy-soft)", lineHeight: 1.5, fontWeight: 600 }}>
            {layer.headlineFinding}
          </div>
        )}
        {read && <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>{read}</div>}
      </div>
    </Link>
  );
}

function LayerRow({ layer }: { layer: OverviewLayer }) {
  const fig = leadFigure(layer);
  return (
    <Link to={`/layers/${layer.key}`} style={{ textDecoration: "none", minWidth: 0 }}>
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div className="font-serif" style={{ fontSize: 15, color: "var(--navy)" }}>
            {layer.name}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: layer.generated ? "var(--slate)" : "var(--slate-light)",
              lineHeight: 1.4,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {layer.generated ? layer.headlineFinding || layer.diagnosticQuestion : "Not generated yet"}
          </div>
        </div>
        {fig.value ? (
          <div className="font-mono" style={{ fontSize: 16, fontWeight: 500, color: toneInkVar[fig.tone], minWidth: 0, overflowWrap: "anywhere" }}>
            {fig.value}
          </div>
        ) : (
          <Tag kind="data">{layer.archetype}</Tag>
        )}
        <ArrowRight size={15} color="var(--gold)" style={{ flexShrink: 0 }} />
      </div>
    </Link>
  );
}
