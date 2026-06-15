// The single source of truth for projecting a stored tenant layer into the
// board-pack-level "overview" item (Phase AB extraction). Both the authenticated
// /overview route and the PUBLIC shareable diagnosis read through buildOverviewItem,
// so the two surfaces can never drift in what they expose or how they null a
// malformed field. This module is database-free and pure, so it is unit-tested in
// isolation; the query that feeds it lives in overview.ts.
//
// The stored content is jsonb, so every field is validated before it is surfaced:
// a malformed value becomes null rather than a fabricated stand-in.

export function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
export function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? (v.filter((x) => x != null && typeof x === "object") as Record<string, unknown>[])
    : [];
}
export function asTone(v: unknown): "good" | "warn" | "bad" | "neutral" | null {
  return v === "good" || v === "warn" || v === "bad" || v === "neutral" ? v : null;
}
export function asBasis(v: unknown): "verified" | "modelled" | null {
  return v === "verified" || v === "modelled" ? v : null;
}

// The single highest-lift gap is the layer's biggest blind spot. Selection by a
// real persisted field (confidence_lift_pp), never a computed score.
export function pickTopGap(gaps: Record<string, unknown>[]) {
  let best: {
    kind: unknown;
    description: string | null;
    closes: string | null;
    confidenceLiftPp: number | null;
  } | null = null;
  let bestLift = -Infinity;
  for (const g of gaps) {
    const lift = asNumber(g.confidence_lift_pp) ?? 0;
    if (lift > bestLift) {
      bestLift = lift;
      best = {
        kind: g.kind,
        description: asString(g.description),
        closes: asString(g.closes),
        confidenceLiftPp: asNumber(g.confidence_lift_pp),
      };
    }
  }
  return best;
}

// The voice report stored on the layer (Phase AB) projected to its honest, small
// surface: the score, the band, and whether it cleared the bar. A layer built
// before the voice check ran has none, so this is null (never a fabricated pass).
export function projectVoice(
  v: unknown,
): { score: number; band: string | null; passed: boolean } | null {
  if (v == null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const score = asNumber(r.score);
  if (score == null) return null;
  const band = asString(r.band);
  return { score, band, passed: r.passed === true };
}

// The exact selected row shape buildOverviewItem consumes. The query in
// overview.ts must produce this; a missing column is a TypeScript error, which is
// what keeps the authed and public surfaces aligned.
export interface OverviewRow {
  key: string;
  name: string;
  archetype: string;
  ownerPersona: string;
  moduleGroup: string;
  sortOrder: number;
  diagnosticQuestion: string;
  feeds: unknown;
  content: Record<string, unknown> | null;
  heroPanel: Record<string, unknown> | null;
  voiceQuality: Record<string, unknown> | null;
  generatedAt: Date | null;
  generatorModel: string | null;
}

export interface OverviewItem {
  key: string;
  name: string;
  archetype: string;
  ownerPersona: string;
  moduleGroup: string;
  sortOrder: number;
  diagnosticQuestion: string;
  feeds: unknown;
  generated: boolean;
  headlineFinding: string | null;
  headlineImpact: string | null;
  headlineLever: string | null;
  narrative: string | null;
  confidence: number | null;
  confidenceGap: number | null;
  leadMetric:
    | { label: string | null; value: string | null; sub: string | null; tone: string | null }
    | null;
  hero:
    | {
        metricLabel: string | null;
        metricValue: string | null;
        metricSub: string | null;
        tone: string | null;
        oneLineRead: string | null;
      }
    | null;
  topAction:
    | {
        title: string | null;
        impact: string | null;
        timing: string | null;
        confidence: number | null;
        basis: string | null;
      }
    | null;
  topGap: ReturnType<typeof pickTopGap>;
  voice: ReturnType<typeof projectVoice>;
  generatedAt: Date | null;
  generatorModel: string | null;
}

// Project one joined registry+content row into the overview item. Pure: no clock,
// no I/O. A row with no generated content yet yields generated:false and honest
// nulls, never placeholder figures.
export function buildOverviewItem(r: OverviewRow): OverviewItem {
  const c = r.content;
  const metrics = c ? asObjectArray(c.metrics) : [];
  const actions = c ? asObjectArray(c.actions) : [];
  const gaps = c ? asObjectArray(c.gaps) : [];
  const lead = metrics[0];
  const action = actions[0];
  const hp = r.heroPanel;
  return {
    key: r.key,
    name: r.name,
    archetype: r.archetype,
    ownerPersona: r.ownerPersona,
    moduleGroup: r.moduleGroup,
    sortOrder: r.sortOrder,
    diagnosticQuestion: r.diagnosticQuestion,
    feeds: r.feeds,
    generated: c != null,
    headlineFinding: c ? asString(c.headline_finding) : null,
    headlineImpact: c ? asString(c.headline_impact) : null,
    headlineLever: c ? asString(c.headline_lever) : null,
    narrative: c ? asString(c.narrative) : null,
    confidence: c ? asNumber(c.confidence) : null,
    confidenceGap: c ? asNumber(c.confidence_gap) : null,
    leadMetric: lead
      ? {
          label: asString(lead.label),
          value: asString(lead.value),
          sub: asString(lead.sub),
          tone: asTone(lead.tone),
        }
      : null,
    hero: hp
      ? {
          metricLabel: asString(hp.metric_label),
          metricValue: asString(hp.metric_value),
          metricSub: asString(hp.metric_sub),
          tone: asTone(hp.tone),
          oneLineRead: asString(hp.one_line_read),
        }
      : null,
    topAction: action
      ? {
          title: asString(action.title),
          impact: asString(action.impact),
          timing: asString(action.timing),
          confidence: asNumber(action.confidence),
          basis: asBasis(action.basis),
        }
      : null,
    topGap: pickTopGap(gaps),
    voice: projectVoice(r.voiceQuality),
    generatedAt: r.generatedAt,
    generatorModel: r.generatorModel,
  };
}

// The summary_only public projection (Phase AB). It strips the internal routing
// fields that a prospect has no business seeing (the owner persona, the
// diagnostic question, and the layer feed graph) and keeps the board-pack-level
// read. It carries NO connector data, NO provenance, NO identities; the overview
// item never held those to begin with, so this is a deliberate further narrowing,
// not a filter we are trusting to catch a leak.
export type PublicDiagnosisLayer = Omit<
  OverviewItem,
  "ownerPersona" | "diagnosticQuestion" | "feeds"
>;

export function toPublicDiagnosisLayer(item: OverviewItem): PublicDiagnosisLayer {
  const { ownerPersona: _o, diagnosticQuestion: _q, feeds: _f, ...rest } = item;
  return rest;
}
