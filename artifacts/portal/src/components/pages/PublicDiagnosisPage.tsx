import React, { useEffect, useState } from "react";
import type {
  CaseStudy,
  PoweredByMark,
  PublicDiagnosis,
  PublicDiagnosisLayer,
  Tone,
} from "../../types";
import { fetchPublicDiagnosis } from "../../lib/publicApi";
import { withBase } from "../../lib/router";
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
  formatUsd,
  pct,
} from "../primitives";

// The public, unauthenticated shareable diagnosis (Phase AB). It renders OUTSIDE
// the auth provider and the app shell: a cold prospect has no session, so this
// page must stand alone with its own scroll wrapper and its own page chrome. It
// shows the board-pack-level read only: the finding, the leading figure, the
// narrative, the recommended move, and the honest blind spot. There is no link
// into the product from a layer (no auth), no raw data, and no provenance beyond
// the basis pill the overview already carried. The case study is aggregate social
// proof; the "powered by" mark is the viral path back to the product.

type State =
  | { kind: "loading" }
  | { kind: "ready"; diagnosis: PublicDiagnosis }
  | { kind: "unavailable" }
  | { kind: "error" };

// Data-driven tone routed through the token scale. The ink variants are AA on the
// light card surface at any figure size.
const TONE_INK: Record<Tone, string> = {
  good: "text-teal-ink",
  warn: "text-amber-ink",
  bad: "text-coral-ink",
  neutral: "text-navy",
};

export function PublicDiagnosisPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchPublicDiagnosis(token).then((out) => {
      if (!alive) return;
      if (out.state === "unavailable") return setState({ kind: "unavailable" });
      if (out.state === "error") return setState({ kind: "error" });
      setState({ kind: "ready", diagnosis: out.diagnosis });
    });
    return () => {
      alive = false;
    };
  }, [token]);

  const generated =
    state.kind === "ready" ? state.diagnosis.layers.filter((l) => l.generated) : [];

  return (
    <div className="scroll-area h-full overflow-y-auto bg-cream">
      <PageWidth space="wide">
        <PageHeader
          eyebrow="Shared diagnosis"
          title="Diagnosis"
          subtitle="A read-only summary, shared with you. No account needed."
        />

        <div className="mt-7">
          {state.kind === "loading" && <SkeletonLines lines={6} />}
          {state.kind === "error" && (
            <ErrorState
              message="This diagnosis could not be loaded."
              onRetry={() => location.reload()}
            />
          )}
          {state.kind === "unavailable" && (
            <EmptyState
              title="This link is not available"
              message="The link may have expired, been revoked, or never existed. Ask whoever shared it for a fresh link."
            />
          )}
          {state.kind === "ready" && generated.length === 0 && (
            <EmptyState
              title="Nothing to show yet"
              message="No intelligence has been generated for this diagnosis."
            />
          )}
          {state.kind === "ready" && generated.length > 0 && (
            <div className="grid gap-4">
              {generated.map((l) => (
                <PublicLayerCard key={l.key} layer={l} />
              ))}
              {state.diagnosis.caseStudy && <CaseStudyCard study={state.diagnosis.caseStudy} />}
            </div>
          )}
        </div>

        {state.kind === "ready" && <PoweredBy mark={state.diagnosis.poweredBy} />}
      </PageWidth>
    </div>
  );
}

function PublicLayerCard({ layer }: { layer: PublicDiagnosisLayer }) {
  const tone: Tone = layer.hero?.tone ?? layer.leadMetric?.tone ?? "neutral";
  const metricValue = layer.hero?.metricValue ?? layer.leadMetric?.value;
  const metricLabel = layer.hero?.metricLabel ?? layer.leadMetric?.label;

  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-serif text-title font-bold text-navy m-0">{layer.name}</h2>
        <Tag kind="model">{layer.archetype}</Tag>
      </div>

      <div className="flex gap-5 mt-3.5 flex-wrap">
        {metricValue && (
          <div className="shrink-0">
            <div className={`font-mono text-section font-medium leading-none break-words ${TONE_INK[tone]}`}>
              {metricValue}
            </div>
            {metricLabel && <div className="eyebrow text-slate-light mt-1.5">{metricLabel}</div>}
          </div>
        )}
        <div className="flex-[1_1_320px] min-w-0">
          {layer.headlineFinding && (
            <div className="font-serif text-[16px] text-navy leading-snug">{layer.headlineFinding}</div>
          )}
          {layer.narrative && (
            <p className="text-[13.5px] text-slate-base leading-relaxed mt-2.5 mb-0">{layer.narrative}</p>
          )}
        </div>
      </div>

      {layer.topAction && (layer.topAction.title || layer.topAction.impact) && (
        <div className="mt-4 border-l-[3px] border-teal pl-3.5">
          <div className="eyebrow text-slate-light mb-1">Recommended move</div>
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
              <span className="eyebrow text-slate-light">{pct(layer.topAction.confidence)} confidence</span>
            )}
          </div>
        </div>
      )}

      {layer.topGap && layer.topGap.description && (
        <div className="mt-3.5 flex gap-2 items-baseline flex-wrap">
          <span className="eyebrow text-amber-ink">Still unknown</span>
          <span className="text-caption text-slate-base">
            {layer.topGap.description}
            {layer.topGap.closes ? ` Closed by ${layer.topGap.closes}.` : ""}
          </span>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-title font-medium text-navy leading-none">{value}</div>
      <div className="eyebrow text-slate-light mt-1.5">{label}</div>
    </div>
  );
}

function CaseStudyCard({ study }: { study: CaseStudy }) {
  return (
    <section className="card card-accent-teal p-6">
      <div className="eyebrow text-slate-light mb-2">Outcomes for companies like this one</div>
      <div className="font-serif text-[16px] text-navy">
        {study.sector}, {study.revenueBand}
      </div>
      <p className="text-[13.5px] text-slate-base leading-relaxed mt-2 mb-0">
        Across {study.contributorCount} comparable companies that acted on their diagnosis, the
        median realised {formatUsd(study.realizedUsd.p50)} of {formatUsd(study.identifiedUsd.p50)}{" "}
        identified.
      </p>
      <div className="flex gap-7 mt-4 flex-wrap">
        <Stat label="Median realised" value={formatUsd(study.realizedUsd.p50)} />
        <Stat label="Median identified" value={formatUsd(study.identifiedUsd.p50)} />
        {study.calibration.score != null && (
          <Stat label="Prediction accuracy" value={pct(study.calibration.score * 100)} />
        )}
      </div>
      {study.noised && (
        <div className="mt-3.5">
          <Pill color="gray">Figures blurred to protect a small cohort</Pill>
        </div>
      )}
    </section>
  );
}

function PoweredBy({ mark }: { mark: PoweredByMark }) {
  return (
    <div className="mt-8 text-center">
      <a href={withBase(mark.href)} className="font-mono text-[12.5px] text-slate-light no-underline">
        {mark.label}
      </a>
    </div>
  );
}
