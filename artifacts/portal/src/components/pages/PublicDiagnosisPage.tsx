import React, { useEffect, useState } from "react";
import type {
  CaseStudy,
  PoweredByMark,
  PublicDiagnosis,
  PublicDiagnosisLayer,
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
  toneColorVar,
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
    <div className="scroll-area" style={{ height: "100%", overflowY: "auto", background: "var(--cream)" }}>
      <PageWidth style={{ paddingTop: 28, paddingBottom: 64 }}>
        <PageHeader
          eyebrow="Shared diagnosis"
          title="Diagnosis"
          subtitle="A read-only summary, shared with you. No account needed."
        />

        <div style={{ marginTop: 28 }}>
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
            <div style={{ display: "grid", gap: 16 }}>
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
  const tone = layer.hero?.tone ?? layer.leadMetric?.tone ?? "neutral";
  const metricValue = layer.hero?.metricValue ?? layer.leadMetric?.value;
  const metricLabel = layer.hero?.metricLabel ?? layer.leadMetric?.label;

  return (
    <section className="card" style={{ padding: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="font-serif" style={{ fontSize: 19, fontWeight: 700, color: "var(--navy)", margin: 0 }}>
          {layer.name}
        </h2>
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
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: "var(--navy)", lineHeight: 1 }}>
        {value}
      </div>
      <div className="eyebrow" style={{ color: "var(--slate-light)", marginTop: 6 }}>
        {label}
      </div>
    </div>
  );
}

function CaseStudyCard({ study }: { study: CaseStudy }) {
  return (
    <section className="card card-accent-teal" style={{ padding: 22 }}>
      <div className="eyebrow" style={{ color: "var(--slate-light)", marginBottom: 8 }}>
        Outcomes for companies like this one
      </div>
      <div className="font-serif" style={{ fontSize: 16, color: "var(--navy)" }}>
        {study.sector}, {study.revenueBand}
      </div>
      <p style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6, margin: "8px 0 0" }}>
        Across {study.contributorCount} comparable companies that acted on their diagnosis, the
        median realized {formatUsd(study.realizedUsd.p50)} of {formatUsd(study.identifiedUsd.p50)}{" "}
        identified.
      </p>
      <div style={{ display: "flex", gap: 28, marginTop: 16, flexWrap: "wrap" }}>
        <Stat label="Median realized" value={formatUsd(study.realizedUsd.p50)} />
        <Stat label="Median identified" value={formatUsd(study.identifiedUsd.p50)} />
        {study.calibration.score != null && (
          <Stat label="Prediction accuracy" value={pct(study.calibration.score * 100)} />
        )}
      </div>
      {study.noised && (
        <div style={{ marginTop: 14 }}>
          <Pill color="gray">Figures blurred to protect a small cohort</Pill>
        </div>
      )}
    </section>
  );
}

function PoweredBy({ mark }: { mark: PoweredByMark }) {
  return (
    <div style={{ marginTop: 32, textAlign: "center" }}>
      <a
        href={withBase(mark.href)}
        className="font-mono"
        style={{ fontSize: 12.5, color: "var(--slate-light)", textDecoration: "none" }}
      >
        {mark.label}
      </a>
    </div>
  );
}
