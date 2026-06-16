import React from "react";
import type {
  Confounder,
  FindingChallenge,
  GapKind,
  LayerAction,
  LayerCause,
  LayerGap,
  LayerHypothesis,
  PeerBenchmark,
  SupplementBlock,
  TenantLayerDetail,
} from "../../types";
import {
  ConfidencePill,
  Eyebrow,
  MetricTile,
  Pill,
  ProvenancePill,
  SectionHeading,
  Tag,
  VerdictPill,
} from "../primitives";
import { ChallengeControl } from "./ChallengeControl";
import { DecisionControl } from "./DecisionControl";

// The wiring a finding card needs to offer the Interactive Challenge (Phase AA):
// the tenant and layer to address, the prior challenges grouped by finding ref,
// whether this seat may raise one, and the callbacks. Absent (undefined) on any
// surface that does not enable challenging, so the cards render unchanged there.
export interface ChallengeContext {
  tenantId: string;
  layerKey: string;
  byRef: Map<string, FindingChallenge[]>;
  canChallenge: boolean;
  onChallenged: (challenge: FindingChallenge) => void;
  onUnauthorized: () => void;
}

export function FindingChallengeSlot({
  ctx,
  findingRef,
}: {
  ctx: ChallengeContext | undefined;
  findingRef: string;
}) {
  if (!ctx) return null;
  const prior = ctx.byRef.get(findingRef) ?? [];
  // Render nothing when this seat cannot challenge and there is no history to
  // show: an empty, honest absence rather than a dead affordance.
  if (!ctx.canChallenge && prior.length === 0) return null;
  return (
    <ChallengeControl
      tenantId={ctx.tenantId}
      layerKey={ctx.layerKey}
      findingRef={findingRef}
      prior={prior}
      canChallenge={ctx.canChallenge}
      onChallenged={ctx.onChallenged}
      onUnauthorized={ctx.onUnauthorized}
    />
  );
}

// The wiring a recommended-action card needs to record a board decision against
// it (Phase AL): the tenant and layer, and whether this seat may decide. Absent
// (undefined) on any surface that does not enable deciding, and rendered only for
// a non-viewer seat, so a viewer sees no dead affordance. A commit is recorded by
// committing the action; only the defer and reject calls live on this slot.
export interface DecisionContext {
  tenantId: string;
  layerKey: string;
  canDecide: boolean;
  onUnauthorized: () => void;
}

export function DecisionActionSlot({
  ctx,
  actionRef,
}: {
  ctx: DecisionContext | undefined;
  actionRef: string;
}) {
  if (!ctx || !ctx.canDecide) return null;
  return (
    <DecisionControl
      tenantId={ctx.tenantId}
      layerKey={ctx.layerKey}
      actionRef={actionRef}
      onUnauthorized={ctx.onUnauthorized}
    />
  );
}

// The shared layer body: everything below the archetype hero. Each section
// renders only when its real content is present, so an under-generated layer
// shows fewer sections rather than empty scaffolding. Order runs from the
// headline read down to provenance: take, metrics, causes, confounders,
// challengers, actions, gaps, peers, supplements, feeds.

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ padding: 18, ...style }}>
      {children}
    </div>
  );
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SourceLinks({ urls }: { urls: string[] }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {urls.map((u, i) => (
        <a
          key={i}
          href={u}
          target="_blank"
          rel="noreferrer noopener"
          className="font-mono"
          style={{ fontSize: 11, color: "var(--blue)", textDecoration: "none" }}
        >
          {host(u)}
        </a>
      ))}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)", margin: 0, lineHeight: 1.25 }}>
      {children}
    </h3>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, color: "var(--slate)", lineHeight: 1.55, margin: "6px 0 0" }}>{children}</p>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 10, marginRight: 8 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--ink, var(--navy))" }}>{value}</span>
    </div>
  );
}

// ── Analyst take ────────────────────────────────────────────────────────────
function AnalystTake({ detail }: { detail: TenantLayerDetail }) {
  const { content } = detail;
  return (
    <section>
      <Eyebrow>Analyst take</Eyebrow>
      <h2
        className="font-serif"
        style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", margin: "6px 0 12px", lineHeight: 1.25 }}
      >
        {content.headline_finding}
      </h2>
      <p style={{ fontSize: 15, color: "var(--slate)", lineHeight: 1.6, maxWidth: 760, whiteSpace: "pre-wrap" }}>
        {content.narrative}
      </p>
      {(content.headline_impact || content.headline_lever) && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          {content.headline_impact && (
            <div className="card card-accent-coral" style={{ flex: "1 1 280px", padding: 14 }}>
              <Eyebrow>What it costs</Eyebrow>
              <Body>{content.headline_impact}</Body>
            </div>
          )}
          {content.headline_lever && (
            <div className="card card-accent-teal" style={{ flex: "1 1 280px", padding: 14 }}>
              <Eyebrow>The lever</Eyebrow>
              <Body>{content.headline_lever}</Body>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Metrics ─────────────────────────────────────────────────────────────────
function Metrics({ detail }: { detail: TenantLayerDetail }) {
  if (detail.content.metrics.length === 0) return null;
  return (
    <section>
      <Eyebrow>Metrics</Eyebrow>
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        }}
      >
        {detail.content.metrics.map((m, i) => (
          <MetricTile key={i} label={m.label} value={m.value} sub={m.sub} tone={m.tone} basis={m.basis} confidence={m.confidence} />
        ))}
      </div>
    </section>
  );
}

// ── Causes ──────────────────────────────────────────────────────────────────
function Causes({ causes, challenge }: { causes: LayerCause[]; challenge?: ChallengeContext }) {
  if (!causes || causes.length === 0) return null;
  return (
    <section>
      <SectionHeading eyebrow="Why this is happening" title="Root causes" />
      <div style={{ display: "grid", gap: 12 }}>
        {causes.map((c, i) => (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <CardTitle>{c.title}</CardTitle>
              <ConfidencePill basis={c.basis} confidence={c.confidence} />
            </div>
            {c.impact && <Field label="Impact" value={c.impact} />}
            <Body>{c.detail}</Body>
            <FindingChallengeSlot ctx={challenge} findingRef={`causes[${i}]`} />
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Confounders (the genuine stage, ranked) ─────────────────────────────────
function Confounders({ confounders }: { confounders: Confounder[] | null }) {
  if (!confounders || confounders.length === 0) return null;
  const ranked = [...confounders].sort((a, b) => a.rank - b.rank);
  return (
    <section>
      <SectionHeading
        eyebrow="What else could explain this"
        title="Confounders, tested and ranked"
      />
      <div style={{ display: "grid", gap: 12 }}>
        {ranked.map((c, i) => (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                <span className="font-mono" style={{ fontSize: 13, color: "var(--slate-light)" }}>
                  {String(c.rank).padStart(2, "0")}
                </span>
                <CardTitle>{c.name}</CardTitle>
              </div>
              <VerdictPill verdict={c.verdict} />
            </div>
            <Field label="Mechanism" value={c.mechanism} />
            <Field label="Direction" value={c.directional_impact} />
            <Body>{c.reason}</Body>
            <SourceLinks urls={c.source_urls} />
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Challenger counters ─────────────────────────────────────────────────────
function Challengers({ hypotheses, challenge }: { hypotheses: LayerHypothesis[]; challenge?: ChallengeContext }) {
  if (!hypotheses || hypotheses.length === 0) return null;
  return (
    <section>
      <SectionHeading eyebrow="The other reading" title="Challenger counters" />
      <div style={{ display: "grid", gap: 12 }}>
        {hypotheses.map((h, i) => (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <CardTitle>{h.statement}</CardTitle>
              <ConfidencePill basis={h.basis} confidence={h.confidence} />
            </div>
            {h.supportingSignals && <Field label="Supporting" value={h.supportingSignals} />}
            {h.alternativeExplanation && <Field label="Alternative" value={h.alternativeExplanation} />}
            <FindingChallengeSlot ctx={challenge} findingRef={`hypotheses[${i}]`} />
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Actions with predicted recovery ─────────────────────────────────────────
function Actions({
  actions,
  challenge,
  decision,
}: {
  actions: LayerAction[];
  challenge?: ChallengeContext;
  decision?: DecisionContext;
}) {
  if (!actions || actions.length === 0) return null;
  return (
    <section>
      <SectionHeading eyebrow="What to do about it" title="Recommended actions" />
      <div style={{ display: "grid", gap: 12 }}>
        {actions.map((a, i) => (
          <Card key={i} style={{ borderLeft: "3px solid var(--teal)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <CardTitle>{a.title}</CardTitle>
              <ConfidencePill basis={a.basis} confidence={a.confidence} />
            </div>
            <Body>{a.detail}</Body>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10 }}>
              {a.impact && <Field label="Predicted recovery" value={a.impact} />}
              {a.timing && <Field label="Timing" value={a.timing} />}
              {a.owner && <Field label="Owner" value={a.owner} />}
            </div>
            <FindingChallengeSlot ctx={challenge} findingRef={`actions[${i}]`} />
            <DecisionActionSlot ctx={decision} actionRef={`actions[${i}]`} />
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Gaps with closing capability ────────────────────────────────────────────
const GAP_TAG: Record<GapKind, "data" | "integ" | "model" | "workflow" | "signal"> = {
  DATA: "data",
  SIGNAL: "signal",
  INTEG: "integ",
  MODEL: "model",
  FLOW: "workflow",
};

function Gaps({ gaps }: { gaps: LayerGap[] }) {
  if (!gaps || gaps.length === 0) return null;
  const ranked = [...gaps].sort((a, b) => b.confidence_lift_pp - a.confidence_lift_pp);
  return (
    <section>
      <SectionHeading eyebrow="What would sharpen this" title="Intelligence gaps" />
      <div style={{ display: "grid", gap: 12 }}>
        {ranked.map((g, i) => (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Tag kind={GAP_TAG[g.kind] ?? "data"}>{g.kind}</Tag>
                <span style={{ fontSize: 14, color: "var(--navy)", fontWeight: 600 }}>{g.description}</span>
              </div>
              {Number.isFinite(g.confidence_lift_pp) && (
                <Pill color="teal">+{g.confidence_lift_pp} pp confidence</Pill>
              )}
            </div>
            {g.closes && <Field label="Closes" value={g.closes} />}
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Peer benchmark ──────────────────────────────────────────────────────────
function Benchmark({ peer }: { peer: PeerBenchmark | null }) {
  if (!peer || !peer.peers || peer.peers.length === 0) return null;
  return (
    <section>
      <SectionHeading eyebrow="Against the field" title={peer.dimension} />
      <Card>
        <div style={{ display: "grid", gap: 8 }}>
          {peer.peers.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                padding: "6px 0",
                borderBottom: i < peer.peers.length - 1 ? "1px solid var(--cream-dark)" : "none",
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  color: p.is_self ? "var(--navy)" : "var(--slate)",
                  fontWeight: p.is_self ? 700 : 500,
                }}
              >
                {p.name}
                {p.is_self && (
                  <span className="eyebrow" style={{ color: "var(--gold-ink)", fontSize: 10, marginLeft: 8 }}>
                    You
                  </span>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                {p.note && <span style={{ fontSize: 12, color: "var(--slate-light)" }}>{p.note}</span>}
                {p.value && (
                  <span className="font-mono" style={{ fontSize: 15, color: p.is_self ? "var(--navy)" : "var(--slate)" }}>
                    {p.value}
                    {peer.unit ? ` ${peer.unit}` : ""}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
        {peer.read && <Body>{peer.read}</Body>}
        <SourceLinks urls={peer.source_urls} />
      </Card>
    </section>
  );
}

// ── Supplements ─────────────────────────────────────────────────────────────
const SUPP_ACCENT: Record<string, "navy" | "amber" | "gold" | "teal" | "coral"> = {
  context: "navy",
  risk: "coral",
  watchlist: "amber",
  quote: "gold",
  stat: "teal",
};

function Supplements({ blocks }: { blocks: SupplementBlock[] }) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <section>
      <SectionHeading eyebrow="Worth knowing" title="Context and watchlist" />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {blocks.map((b, i) => (
          <div key={i} className={`card card-accent-${SUPP_ACCENT[b.kind] ?? "navy"}`} style={{ padding: 16 }}>
            <Eyebrow>{b.kind}</Eyebrow>
            <CardTitle>{b.title}</CardTitle>
            <Body>{b.body}</Body>
            <SourceLinks urls={b.source_urls} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Feeds (what this layer draws on) ────────────────────────────────────────
function Feeds({ feeds }: { feeds: string[] }) {
  if (!feeds || feeds.length === 0) return null;
  return (
    <section>
      <SectionHeading eyebrow="What feeds this layer" title="Source feeds" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {feeds.map((f, i) => (
          <Tag key={i} kind="data">
            {f}
          </Tag>
        ))}
      </div>
    </section>
  );
}

export function LayerSections({
  detail,
  feeds,
  challenge,
  decision,
}: {
  detail: TenantLayerDetail;
  feeds: string[];
  challenge?: ChallengeContext;
  decision?: DecisionContext;
}) {
  const supplements = detail.supplementBlocks?.blocks ?? [];
  return (
    <>
      <AnalystTake detail={detail} />
      <Metrics detail={detail} />
      <Causes causes={detail.content.causes} challenge={challenge} />
      <Confounders confounders={detail.confounders} />
      <Challengers hypotheses={detail.content.hypotheses} challenge={challenge} />
      <Actions actions={detail.content.actions} challenge={challenge} decision={decision} />
      <Gaps gaps={detail.content.gaps} />
      <Benchmark peer={detail.peerBenchmark} />
      <Supplements blocks={supplements} />
      <Feeds feeds={feeds} />
    </>
  );
}
