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
  GoldUnderlineSweep,
  PageHeader,
  PageWidth,
  SectionHeading,
  SerifDiagnosis,
  SkeletonLines,
  Tag,
  formatDate,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; overview: OverviewLayer[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

// Data-driven tone routed through the token scale, never an inline colour. The
// ink variants are AA on the light surfaces; the diagnosis tones colour the
// leading rule only, so the conclusion always reads in navy authority.
const TONE_INK: Record<Tone, string> = {
  good: "text-teal-ink",
  warn: "text-amber-ink",
  bad: "text-coral-ink",
  neutral: "text-navy",
};
const TONE_DIAGNOSIS: Record<Tone, "teal" | "amber" | "coral" | "navy"> = {
  good: "teal",
  warn: "amber",
  bad: "coral",
  neutral: "navy",
};

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
    <PageWidth space="page">
      <PageHeader
        eyebrow="Morning brief"
        title={current ? current.name : "Morning brief"}
        subtitle={current ? current.tagline || current.sector || current.url : undefined}
        actions={
          lastGenerated ? (
            <span className="eyebrow text-slate-light">
              {PERSPECTIVE_LABEL[perspective]} lens &middot; generated {formatDate(lastGenerated)}
            </span>
          ) : undefined
        }
      />

      <div className="mt-7">
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The brief could not be assembled." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No company in your scope yet"
            message="Once a company is bound to your organisation, its morning brief will appear here."
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
            <BriefHero layer={leads[0]} />

            {leads.length > 1 && (
              <div className="mt-10">
                <SectionHeading eyebrow="Also worth your attention" title="The next leads" />
                <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                  {leads.slice(1).map((l) => (
                    <LeadCard key={l.key} layer={l} />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-10">
              <SectionHeading
                eyebrow="Every layer"
                title="The full picture"
                action={
                  <Link to="/board" className="btn-ghost no-underline inline-flex items-center gap-1.5">
                    <FileText size={14} /> Board pack
                  </Link>
                }
              />
              <div className="grid gap-2">
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

// The brief's hero: the single leading layer read as a confident serif diagnosis,
// with its leading figure beside it. The gold rule sweeps in beneath the figure,
// keyed on the layer's generation time so it replays only when the layer is
// regenerated, never on a stray re-render. A layer with no figure shows no figure.
function BriefHero({ layer }: { layer: OverviewLayer }) {
  const fig = leadFigure(layer);
  const read = layer.hero?.oneLineRead || layer.headlineImpact;
  return (
    <div className="surface surface-cream p-6 md:p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <SerifDiagnosis
          eyebrow={layer.name}
          tone={TONE_DIAGNOSIS[fig.tone]}
          lead
          support={read || undefined}
          action={
            <Link
              to={`/layers/${layer.key}`}
              className="btn-primary no-underline inline-flex items-center gap-1.5"
            >
              See the diagnosis <ArrowRight size={15} />
            </Link>
          }
        >
          {layer.headlineFinding || layer.diagnosticQuestion}
        </SerifDiagnosis>
        {fig.value && (
          <div className="md:text-right">
            <GoldUnderlineSweep sweepKey={layer.generatedAt ?? undefined}>
              <span className={`font-mono text-display font-medium leading-none break-words ${TONE_INK[fig.tone]}`}>
                {fig.value}
              </span>
            </GoldUnderlineSweep>
            {fig.label && <div className="eyebrow text-slate-light mt-2">{fig.label}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function LeadCard({ layer }: { layer: OverviewLayer }) {
  const fig = leadFigure(layer);
  const read = layer.hero?.oneLineRead || layer.headlineImpact;
  return (
    <Link to={`/layers/${layer.key}`} className="no-underline min-w-0">
      <div className="card h-full flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-serif text-lead text-navy">{layer.name}</span>
          <ArrowRight size={16} color="var(--gold)" className="shrink-0" />
        </div>
        {fig.value && (
          <div>
            <div className={`font-mono text-section font-medium leading-none break-words ${TONE_INK[fig.tone]}`}>
              {fig.value}
            </div>
            {fig.label && <div className="eyebrow text-slate-light mt-1.5">{fig.label}</div>}
          </div>
        )}
        {layer.headlineFinding && (
          <div className="text-[14px] text-navy-soft leading-normal font-semibold">{layer.headlineFinding}</div>
        )}
        {read && <div className="text-caption text-slate-base leading-normal">{read}</div>}
      </div>
    </Link>
  );
}

function LayerRow({ layer }: { layer: OverviewLayer }) {
  const fig = leadFigure(layer);
  return (
    <Link to={`/layers/${layer.key}`} className="no-underline min-w-0">
      <div className="card flex items-center gap-3.5 px-4 py-3 flex-wrap">
        <div className="flex-[1_1_220px] min-w-0">
          <div className="font-serif text-body text-navy">{layer.name}</div>
          <div
            className={`text-[12.5px] leading-snug mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap ${
              layer.generated ? "text-slate-base" : "text-slate-light"
            }`}
          >
            {layer.generated ? layer.headlineFinding || layer.diagnosticQuestion : "Not generated yet"}
          </div>
        </div>
        {fig.value ? (
          <div className={`font-mono text-[16px] font-medium min-w-0 break-words ${TONE_INK[fig.tone]}`}>
            {fig.value}
          </div>
        ) : (
          <Tag kind="data">{layer.archetype}</Tag>
        )}
        <ArrowRight size={15} color="var(--gold)" className="shrink-0" />
      </div>
    </Link>
  );
}
