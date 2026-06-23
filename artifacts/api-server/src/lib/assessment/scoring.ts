// Deterministic, model-free scoring and templating for the Intelligence Gap
// Assessment (Phase AT). Pure functions only: no database, no clock, no model
// call, so the scoring is instant, free, cannot fabricate, and is fully unit
// testable. The honesty contract is here: a strong set of answers scores well
// and the report flips its message, a blind set scores poorly, and the gap to
// layer mapping is driven by the prospect's own weak answers.

import {
  DIMENSIONS,
  SCORED_QUESTIONS,
  type AssessmentDimensionKey,
  type AssessmentDimensionMeta,
} from "./questions";

export type ScoreBand = "blind" | "reactive" | "ahead";

export interface DimensionScore {
  key: AssessmentDimensionKey;
  label: string;
  blurb: string;
  // 0..100, computed from the prospect's own answers, never rigged.
  score: number;
  band: ScoreBand;
}

export interface ComputedScores {
  dimensions: DimensionScore[];
  overall: { score: number; band: ScoreBand };
}

// The thresholds that turn a 0..100 dimension score into a band. A perfect set
// of answers lands "ahead" so a sharp operation passes; a flying-blind set lands
// "blind".
export function bandFor(score: number): ScoreBand {
  if (score <= 33) return "blind";
  if (score <= 66) return "reactive";
  return "ahead";
}

// Compute the four-dimension shape from validated answers. Each dimension is the
// sum of its answers' rung scores normalised to 0..100 against that dimension's
// own maximum, so dimensions with a different number of questions stay
// comparable. The overall is the mean of the four dimension scores.
export function computeScores(answers: Record<string, "blind" | "partial" | "ahead">): ComputedScores {
  const rungScore: Record<string, number> = { blind: 0, partial: 1, ahead: 2 };

  const dimensions: DimensionScore[] = DIMENSIONS.map((meta: AssessmentDimensionMeta) => {
    const questions = SCORED_QUESTIONS.filter((q) => q.dimension === meta.key);
    const max = questions.length * 2;
    let raw = 0;
    for (const q of questions) {
      const chosen = answers[q.id];
      raw += rungScore[chosen] ?? 0;
    }
    const score = max === 0 ? 0 : Math.round((raw / max) * 100);
    return { key: meta.key, label: meta.label, blurb: meta.blurb, score, band: bandFor(score) };
  });

  const overallScore =
    dimensions.length === 0
      ? 0
      : Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);

  return { dimensions, overall: { score: overallScore, band: bandFor(overallScore) } };
}

export interface GapLayerSelection {
  layerKey: string;
  // The aggregate weakness weight pointing at this layer: a flying-blind answer
  // contributes 2, a partial answer 1, an ahead answer 0.
  weight: number;
  // The dimensions whose weak answers point at this layer.
  dimensions: AssessmentDimensionKey[];
}

// Select the canonical layers the prospect's weak answers point to, ranked by
// aggregate weakness. Driven entirely by their own answers: a layer only appears
// because a question tagged to it was answered below "ahead". An operation that
// answers everything "ahead" yields an empty selection, which the report reads
// as a strong result rather than inventing a gap.
export function selectGapLayers(answers: Record<string, "blind" | "partial" | "ahead">): GapLayerSelection[] {
  const byKey = new Map<string, { weight: number; dims: Set<AssessmentDimensionKey> }>();
  for (const q of SCORED_QUESTIONS) {
    const chosen = answers[q.id];
    const w = chosen === "blind" ? 2 : chosen === "partial" ? 1 : 0;
    if (w === 0) continue;
    for (const layerKey of q.layerKeys) {
      const entry = byKey.get(layerKey) ?? { weight: 0, dims: new Set<AssessmentDimensionKey>() };
      entry.weight += w;
      entry.dims.add(q.dimension);
      byKey.set(layerKey, entry);
    }
  }
  return [...byKey.entries()]
    .map(([layerKey, v]) => ({ layerKey, weight: v.weight, dimensions: [...v.dims] }))
    .sort((a, b) => b.weight - a.weight || a.layerKey.localeCompare(b.layerKey));
}

// The weakest dimensions first, strongest last. Ties broken by the reading order
// of DIMENSIONS so the output is stable.
export function rankDimensionsByWeakness(scores: ComputedScores): DimensionScore[] {
  const order = new Map(DIMENSIONS.map((d, i) => [d.key, i]));
  return [...scores.dimensions].sort(
    (a, b) => a.score - b.score || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0),
  );
}

// A short, honest, templated read of each dimension when it is weak. These are
// the gap stated plainly in the analyst voice; no model call, so they are
// instant and cannot fabricate.
const WEAK_FRAGMENT: Record<AssessmentDimensionKey, string> = {
  visibility: "the signal is not there to act on, so problems are discovered rather than seen",
  speed: "you find out too late to do much about it",
  foresight: "you react to events rather than seeing them coming",
  confidence: "you cannot tell what is measured from what is estimated, so the numbers are trusted more than they have earned",
};

const STRONG_FRAGMENT: Record<AssessmentDimensionKey, string> = {
  visibility: "you have the signal",
  speed: "you know quickly once it exists",
  foresight: "you see things coming",
  confidence: "you know what is measured versus modelled",
};

export interface GapNarrative {
  headline: string;
  // One idea per paragraph, in reading order.
  paragraphs: string[];
}

// Build the templated gap narrative. For a strong scorer the message flips: the
// risk is not blindness but concentration, and Elevated Intelligence
// institutionalises an edge that currently lives in a few people's heads.
export function buildNarrative(scores: ComputedScores): GapNarrative {
  const ranked = rankDimensionsByWeakness(scores);
  const weak = ranked.filter((d) => d.band !== "ahead");
  const strong = ranked.filter((d) => d.band === "ahead");

  if (weak.length === 0) {
    return {
      headline: "You are ahead, and that is the risk",
      paragraphs: [
        "Your answers describe a sharp operation. You have the signal, you act on it quickly, and you know what is measured versus modelled. That is rare and it is worth defending.",
        "The exposure is not blindness, it is concentration. An edge this good usually lives in a few experienced people rather than in the business itself, so it does not scale and it walks out of the door when they do.",
        "This is exactly where Elevated Intelligence earns its place: it institutionalises the judgement you already have, so the whole organisation reads the business the way your best people do.",
      ],
    };
  }

  const weakest = weak[0];
  const others = weak.slice(1);
  const lead =
    strong.length > 0
      ? `Your answers point to a clear shape. You read well on ${listLabels(strong)}, but you are ${weakest.band} on ${weakest.label.toLowerCase()}: ${WEAK_FRAGMENT[weakest.key]}.`
      : `Your answers point to a clear shape. You are ${weakest.band} on ${weakest.label.toLowerCase()}: ${WEAK_FRAGMENT[weakest.key]}.`;

  const paragraphs: string[] = [lead];
  if (others.length > 0) {
    paragraphs.push(
      `The same pattern shows up in ${listLabels(others)}, where ${others.map((d) => WEAK_FRAGMENT[d.key]).join(", and ")}.`,
    );
  }
  paragraphs.push(
    "None of this is a failing of effort. It is what happens when the systems record what happened but nothing turns that record into what it means in time to act on it.",
  );

  return { headline: headlineFor(weakest), paragraphs };
}

function headlineFor(weakest: DimensionScore): string {
  switch (weakest.key) {
    case "visibility":
      return "You are flying on numbers you cannot fully see";
    case "speed":
      return "You are finding out after the moment to act has passed";
    case "foresight":
      return "You are reacting to events you could have seen coming";
    case "confidence":
      return "You are trusting numbers you cannot fully stand behind";
    default:
      return "There is a gap between what you record and what you know";
  }
}

function listLabels(dims: DimensionScore[]): string {
  const labels = dims.map((d) => d.label.toLowerCase());
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// The single teaching line. A constant, never computed from state.
export const ONE_LINE =
  "Your software records what happened. Elevated Intelligence tells you what it means and what to do.";

export interface CostFraming {
  lines: string[];
}

// Qualitative cost framing, derived only from the prospect's own stated revenue
// band and their weak dimensions. It NEVER invents a figure, a benchmark or a
// precision the answers do not support: the honesty is the selling point. The
// revenue band is the prospect's own input, used as a qualitative scale word,
// never multiplied into a fabricated number.
const BAND_SCALE: Record<string, string> = {
  under_5m: "at your scale",
  "5m_20m": "on a revenue base in the millions",
  "20m_100m": "on a revenue base in the tens of millions",
  "100m_500m": "on a revenue base in the hundreds of millions",
  over_500m: "at your scale",
};

const COST_FRAGMENT: Record<AssessmentDimensionKey, string> = {
  visibility: "Decisions made on numbers you cannot fully see are decisions made on guesswork, and guesswork compounds.",
  speed: "Every week you find out late is a week a competitor who sees it sooner can act first.",
  foresight: "Customers and cash that leave without warning cost far more to win back than they would have cost to keep.",
  confidence: "When you cannot separate measured from estimated, you either act on false precision or hesitate when you should move. Both are expensive.",
};

export function buildCostFraming(scores: ComputedScores, revenueBand: string): CostFraming {
  const ranked = rankDimensionsByWeakness(scores);
  const weak = ranked.filter((d) => d.band !== "ahead");
  const scale = BAND_SCALE[revenueBand] ?? "at your scale";

  if (weak.length === 0) {
    return {
      lines: [
        `The cost here is not waste, it is fragility. ${capitalise(scale)}, an edge that lives in a few heads is one resignation away from disappearing.`,
        "There is no precise figure to quote, and we will not invent one. The point is simpler: institutionalising the judgement you already have protects a return you are already earning.",
      ],
    };
  }

  const lines: string[] = [];
  lines.push(
    `We will not put a precise figure on this, because your answers do not support one and an invented number would be dishonest. The shape of the cost is clear enough.`,
  );
  for (const d of weak.slice(0, 2)) {
    lines.push(COST_FRAGMENT[d.key]);
  }
  lines.push(
    `${capitalise(scale)}, even a small share of decisions moving on a blind spot is a material amount of money moving on guesswork.`,
  );
  return { lines };
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
