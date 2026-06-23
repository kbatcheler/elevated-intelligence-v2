// The Intelligence Gap Assessment question bank (Phase AT). Deterministic and
// model free. Every scored question is a small mirror: it asks about concrete
// behaviour and timing, never opinion, so the honest answer is slightly
// uncomfortable and the discomfort is the realisation. Each scored question
// targets one of the four dimensions and is tagged to one or more of the
// fourteen canonical layers, so a weak answer translates into the specific
// layers that close it.
//
// Scoring is honest by design: the rungs run from flying blind (0) through
// partial (1) to ahead of it (2), and a genuinely sharp operation scores well.
// An instrument that fails everyone reads as manipulative, so the ones who
// deserve to pass do pass.
//
// All option keys, dimension keys and layer keys are stable American data
// identifiers, kept verbatim. All prospect-facing copy is plain professional
// British English with no Oxford commas.

export type AssessmentDimensionKey = "visibility" | "speed" | "foresight" | "confidence";

export interface AssessmentDimensionMeta {
  key: AssessmentDimensionKey;
  label: string;
  blurb: string;
}

// The four things Elevated Intelligence improves, mapped onto the provenance
// brand. Order is the reading order on the report.
export const DIMENSIONS: AssessmentDimensionMeta[] = [
  { key: "visibility", label: "Visibility", blurb: "Whether you have the signal at all" },
  { key: "speed", label: "Speed", blurb: "How fast you know once it exists" },
  { key: "foresight", label: "Foresight", blurb: "Whether you see it coming or only react" },
  {
    key: "confidence",
    label: "Confidence",
    blurb: "Whether you trust your numbers and know what is verified",
  },
];

export interface ScoredOption {
  // Stable identifier for the rung. Same three keys across every question.
  key: "blind" | "partial" | "ahead";
  label: string;
  // 0 flying blind, 1 partial, 2 ahead of it.
  score: 0 | 1 | 2;
}

export interface ScoredQuestion {
  id: string;
  dimension: AssessmentDimensionKey;
  prompt: string;
  // The canonical layer keys a weak answer here points to.
  layerKeys: string[];
  // Ordered blind to ahead.
  options: ScoredOption[];
}

// Ten scored questions: three Visibility, two Speed, three Foresight, two
// Confidence. Each option scores 0, 1 or 2 with three being unreachable so the
// dimension maxima are even.
export const SCORED_QUESTIONS: ScoredQuestion[] = [
  {
    id: "visibility_attribution",
    dimension: "visibility",
    prompt: "When the monthly numbers miss the plan, how quickly can you say which part of the business caused it?",
    layerKeys: ["business-performance", "finance"],
    options: [
      { key: "blind", label: "We see the miss but cannot break it down", score: 0 },
      { key: "partial", label: "We can break it down after some manual digging", score: 1 },
      { key: "ahead", label: "We can attribute it to the driver within a day", score: 2 },
    ],
  },
  {
    id: "visibility_customer_view",
    dimension: "visibility",
    prompt: "Do you have one trustworthy view of each customer across sales, support and billing?",
    layerKeys: ["customer-intelligence", "sales-pipeline"],
    options: [
      { key: "blind", label: "The data sits in separate systems that do not reconcile", score: 0 },
      { key: "partial", label: "We can stitch it together when someone asks", score: 1 },
      { key: "ahead", label: "We have one reconciled view anyone can pull", score: 2 },
    ],
  },
  {
    id: "visibility_margin",
    dimension: "visibility",
    prompt: "Can you see margin at the level of an individual deal or product line?",
    layerKeys: ["pricing-margin", "finance"],
    options: [
      { key: "blind", label: "We see margin only at the company level", score: 0 },
      { key: "partial", label: "We can work it out per line with real effort", score: 1 },
      { key: "ahead", label: "We see per-line margin as a matter of course", score: 2 },
    ],
  },
  {
    id: "speed_close",
    dimension: "speed",
    prompt: "How long after month end before the numbers are good enough to act on?",
    layerKeys: ["finance", "business-performance"],
    options: [
      { key: "blind", label: "Three weeks or more, by which point it is history", score: 0 },
      { key: "partial", label: "Around a week or two", score: 1 },
      { key: "ahead", label: "A few days, while there is still time to act", score: 2 },
    ],
  },
  {
    id: "speed_alerting",
    dimension: "speed",
    prompt: "When something important moves, how do you find out?",
    layerKeys: ["business-performance", "demand-intelligence"],
    options: [
      { key: "blind", label: "Someone notices eventually and raises it", score: 0 },
      { key: "partial", label: "We catch it at the next scheduled review", score: 1 },
      { key: "ahead", label: "We are alerted automatically when it moves", score: 2 },
    ],
  },
  {
    id: "foresight_churn",
    dimension: "foresight",
    prompt: "When a good customer is about to leave, when do you find out?",
    layerKeys: ["customer-intelligence"],
    options: [
      { key: "blind", label: "After they have already gone", score: 0 },
      { key: "partial", label: "When the renewal comes up", score: 1 },
      { key: "ahead", label: "We see the warning signs weeks ahead", score: 2 },
    ],
  },
  {
    id: "foresight_forecast",
    dimension: "foresight",
    prompt: "How much do you trust the forecast for next quarter's revenue?",
    layerKeys: ["sales-pipeline", "demand-intelligence"],
    options: [
      { key: "blind", label: "It is largely a guess we revise as we go", score: 0 },
      { key: "partial", label: "It is reasonable but often wrong on timing", score: 1 },
      { key: "ahead", label: "It is driver-based and holds up against actuals", score: 2 },
    ],
  },
  {
    id: "foresight_cash",
    dimension: "foresight",
    prompt: "Can you see a cash or collections problem before it lands?",
    layerKeys: ["receivables", "finance"],
    options: [
      { key: "blind", label: "We find out when the cash does not arrive", score: 0 },
      { key: "partial", label: "We get a rough sense from the ageing report", score: 1 },
      { key: "ahead", label: "We forecast it and chase the risk early", score: 2 },
    ],
  },
  {
    id: "confidence_reporting",
    dimension: "confidence",
    prompt: "When you read a number in a board pack, do you know what is measured and what is estimated?",
    layerKeys: ["business-performance", "finance"],
    options: [
      { key: "blind", label: "We trust the headline number and move on", score: 0 },
      { key: "partial", label: "We know roughly which figures are soft", score: 1 },
      { key: "ahead", label: "We know exactly what is measured versus modelled", score: 2 },
    ],
  },
  {
    id: "confidence_decisions",
    dimension: "confidence",
    prompt: "When you make a big call, can you point to the evidence behind it later?",
    layerKeys: ["business-performance", "competitive-intelligence"],
    options: [
      { key: "blind", label: "The reasoning lives in people's heads", score: 0 },
      { key: "partial", label: "We can reconstruct it if pushed", score: 1 },
      { key: "ahead", label: "The evidence and the decision are recorded together", score: 2 },
    ],
  },
];

export interface QualificationOption {
  key: string;
  label: string;
}

export interface QualificationQuestion {
  id: "sector" | "revenueBand" | "systems";
  prompt: string;
  kind: "single" | "multi";
  options: QualificationOption[];
}

// Three qualification questions. They do not score the gap; they route and
// qualify the lead and they let the report name the prospect's likely systems
// when it maps gaps to layers. Revenue bands are ranges, never an exact figure.
export const QUALIFICATION_QUESTIONS: QualificationQuestion[] = [
  {
    id: "sector",
    prompt: "Which best describes your sector?",
    kind: "single",
    options: [
      { key: "technology", label: "Technology and software" },
      { key: "manufacturing", label: "Manufacturing and industrials" },
      { key: "retail_ecommerce", label: "Retail and ecommerce" },
      { key: "professional_services", label: "Professional services" },
      { key: "healthcare", label: "Healthcare and life sciences" },
      { key: "financial_services", label: "Financial services" },
      { key: "other", label: "Something else" },
    ],
  },
  {
    id: "revenueBand",
    prompt: "Roughly what is your annual revenue?",
    kind: "single",
    options: [
      { key: "under_5m", label: "Under 5 million" },
      { key: "5m_20m", label: "5 to 20 million" },
      { key: "20m_100m", label: "20 to 100 million" },
      { key: "100m_500m", label: "100 to 500 million" },
      { key: "over_500m", label: "Over 500 million" },
    ],
  },
  {
    id: "systems",
    prompt: "Which core systems do you run? Choose any that apply.",
    kind: "multi",
    options: [
      { key: "crm", label: "A CRM such as Salesforce or HubSpot" },
      { key: "erp", label: "An ERP or accounting platform such as NetSuite or Xero" },
      { key: "warehouse", label: "A data warehouse or BI tool such as Snowflake or Power BI" },
      { key: "commerce", label: "A commerce or point-of-sale platform" },
      { key: "support", label: "A support desk such as Zendesk" },
      { key: "hris", label: "An HR system" },
      { key: "spreadsheets", label: "Mostly spreadsheets" },
    ],
  },
];

// Fast lookups built once at module load.
const SCORED_BY_ID = new Map(SCORED_QUESTIONS.map((q) => [q.id, q]));
const SECTOR_KEYS = new Set(
  (QUALIFICATION_QUESTIONS.find((q) => q.id === "sector")?.options ?? []).map((o) => o.key),
);
const REVENUE_KEYS = new Set(
  (QUALIFICATION_QUESTIONS.find((q) => q.id === "revenueBand")?.options ?? []).map((o) => o.key),
);
const SYSTEM_KEYS = new Set(
  (QUALIFICATION_QUESTIONS.find((q) => q.id === "systems")?.options ?? []).map((o) => o.key),
);

export function getScoredQuestion(id: string): ScoredQuestion | undefined {
  return SCORED_BY_ID.get(id);
}

export function systemLabel(key: string): string | null {
  const q = QUALIFICATION_QUESTIONS.find((x) => x.id === "systems");
  return q?.options.find((o) => o.key === key)?.label ?? null;
}

export interface ValidatedAnswers {
  answers: Record<string, "blind" | "partial" | "ahead">;
}

export interface ValidatedQualification {
  sector: string;
  revenueBand: string;
  systems: string[];
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Validate the scored answers: every scored question must be answered with a
// known option key, and no unknown question id is accepted. Trusted raw input
// from a public endpoint is never persisted unchecked.
export function validateAnswers(raw: unknown): ValidationResult<ValidatedAnswers["answers"]> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "answers must be an object" };
  }
  const input = raw as Record<string, unknown>;
  const out: Record<string, "blind" | "partial" | "ahead"> = {};
  for (const key of Object.keys(input)) {
    if (!SCORED_BY_ID.has(key)) return { ok: false, error: `unknown question: ${key}` };
  }
  for (const q of SCORED_QUESTIONS) {
    const chosen = input[q.id];
    if (typeof chosen !== "string") return { ok: false, error: `missing answer: ${q.id}` };
    const opt = q.options.find((o) => o.key === chosen);
    if (!opt) return { ok: false, error: `invalid option for ${q.id}: ${chosen}` };
    out[q.id] = opt.key;
  }
  return { ok: true, value: out };
}

// Validate the qualification answers. sector and revenueBand must each be a known
// single key; systems must be an array of known keys, deduplicated, possibly
// empty.
export function validateQualification(raw: unknown): ValidationResult<ValidatedQualification> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "qualification must be an object" };
  }
  const input = raw as Record<string, unknown>;
  const sector = input.sector;
  if (typeof sector !== "string" || !SECTOR_KEYS.has(sector)) {
    return { ok: false, error: "invalid sector" };
  }
  const revenueBand = input.revenueBand;
  if (typeof revenueBand !== "string" || !REVENUE_KEYS.has(revenueBand)) {
    return { ok: false, error: "invalid revenueBand" };
  }
  const rawSystems = input.systems;
  if (!Array.isArray(rawSystems)) return { ok: false, error: "systems must be an array" };
  const systems: string[] = [];
  for (const s of rawSystems) {
    if (typeof s !== "string" || !SYSTEM_KEYS.has(s)) {
      return { ok: false, error: `invalid system: ${String(s)}` };
    }
    if (!systems.includes(s)) systems.push(s);
  }
  return { ok: true, value: { sector, revenueBand, systems } };
}

// The public projection of the question bank, sent to the flow. The option
// scores are deliberately withheld: the prospect answers honestly about
// behaviour, not against a visible weighting.
export interface PublicScoredOption {
  key: string;
  label: string;
}
export interface PublicScoredQuestion {
  id: string;
  dimension: AssessmentDimensionKey;
  prompt: string;
  options: PublicScoredOption[];
}
export interface PublicQuestionBank {
  dimensions: AssessmentDimensionMeta[];
  scored: PublicScoredQuestion[];
  qualification: QualificationQuestion[];
}

export function publicQuestionBank(): PublicQuestionBank {
  return {
    dimensions: DIMENSIONS,
    scored: SCORED_QUESTIONS.map((q) => ({
      id: q.id,
      dimension: q.dimension,
      prompt: q.prompt,
      options: q.options.map((o) => ({ key: o.key, label: o.label })),
    })),
    qualification: QUALIFICATION_QUESTIONS,
  };
}
