// Editorial voice quality (Phase AB). A deterministic, side-effect-free
// measurement of an assembled layer's prose against a fixed editorial bar. It is
// a MEASUREMENT, never an edit: it reports a score and per-check detail and never
// rewrites a single character of model output. Rewriting the prose to "pass"
// would be fabricating output, so the orchestrator records this report alongside
// the content and surfaces it honestly; a below-bar layer is shown with its real
// (lower) band, not silently corrected.
//
// Every check is a genuine editorial property, not a knob rigged to pass:
//   sentence_length    prose reads in a human band, neither choppy nor run-on
//   no_hype            no marketing hype words (the house voice is plain)
//   no_first_person    speaks about the company, not in a consultant "we" voice
//   numeric_specificity the narrative cites concrete figures, not vague claims
//   has_proof          at least one proof receipt backs the layer
//   names_gaps         the diagnosis names at least one blind spot (honesty)
//   no_long_dash       no em/en dash slipped through (confirms the typography ban)

import type { LayerContent } from "../schemas/content";

export type VoiceBand = "strong" | "adequate" | "weak";

export interface VoiceCheck {
  id: string;
  label: string;
  passed: boolean;
  // An honest, human-readable measurement (for example "avg 17.2 words/sentence"
  // or "2 hype word(s): seamless, world-class"). Never a fabricated value.
  detail: string;
}

export interface VoiceReport {
  // 0..100, the share of checks that passed, rounded. Deterministic.
  score: number;
  band: VoiceBand;
  // True when the layer clears the editorial bar (adequate or strong).
  passed: boolean;
  checks: VoiceCheck[];
}

// The pass bar. A layer at or above this clears the editorial gate; below it is
// reported "weak" and shown honestly. 70 means at least five of the seven checks
// must hold.
export const VOICE_BAR = 70;
const STRONG_BAND = 85;

// Acceptable average words-per-sentence band for the narrative prose.
const MIN_AVG_SENTENCE_WORDS = 8;
const MAX_AVG_SENTENCE_WORDS = 30;
// The narrative plus headlines should carry at least this many concrete figures.
const MIN_NUMERIC_FIGURES = 2;

// Marketing hype the house voice does not use. Matched case-insensitively on word
// boundaries (hyphenated forms included explicitly). Deliberately conservative:
// only words that are hype in any business context, so a real, plain narrative is
// not failed for ordinary vocabulary.
const HYPE_WORDS: readonly string[] = [
  "revolutionary",
  "game-changer",
  "game changer",
  "cutting-edge",
  "cutting edge",
  "world-class",
  "world class",
  "best-in-class",
  "best in class",
  "synergy",
  "synergies",
  "paradigm",
  "disruptive",
  "seamless",
  "seamlessly",
  "supercharge",
  "turbocharge",
  "unparalleled",
  "effortless",
  "magical",
];

// First-person plural markers. The diagnosis speaks ABOUT the company, so a
// consultant "we/our/us" voice is an editorial miss. Contractions included.
const FIRST_PERSON: readonly string[] = [
  "we",
  "we're",
  "we've",
  "we'll",
  "our",
  "ours",
  "us",
  "let's",
];

const LONG_DASH = /[\u2014\u2013]/;

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build one alternation regex matching any of the phrases on a word boundary,
// case-insensitive. Returns the distinct matched phrases found in the text.
function findPhrases(text: string, phrases: readonly string[]): string[] {
  const found = new Set<string>();
  for (const phrase of phrases) {
    const re = new RegExp("\\b" + escapeForRegex(phrase) + "\\b", "i");
    if (re.test(text)) found.add(phrase);
  }
  return [...found];
}

// Collect every human-authored string in the content into one bag for the broad
// scans (hype, first person, long dash). Numbers, confidence and basis are not
// prose and are excluded.
function collectProse(content: LayerContent): string {
  const parts: string[] = [
    content.narrative,
    content.headline_finding,
    content.headline_impact,
    content.headline_lever,
  ];
  for (const c of content.causes) parts.push(c.title, c.impact, c.detail);
  for (const a of content.actions) {
    parts.push(a.title, a.impact, a.detail);
    if (a.timing) parts.push(a.timing);
    if (a.owner) parts.push(a.owner);
  }
  for (const h of content.hypotheses) {
    parts.push(h.statement);
    if (h.supportingSignals) parts.push(h.supportingSignals);
    if (h.alternativeExplanation) parts.push(h.alternativeExplanation);
  }
  for (const m of content.metrics) {
    parts.push(m.label, m.value);
    if (m.sub) parts.push(m.sub);
  }
  for (const p of content.proof.items) parts.push(p.source, p.observation);
  return parts.join("\n");
}

function avgSentenceWords(narrative: string): { avg: number; sentences: number } {
  // Split only on a terminator followed by whitespace or end-of-string, so a
  // decimal point inside a figure ("2.1x", "1.8 million") does not fracture a
  // sentence and spuriously deflate the average. A real sentence end is always
  // followed by a space or the end of the prose.
  const sentences = narrative
    .split(/[.!?]+(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return { avg: 0, sentences: 0 };
  let words = 0;
  for (const s of sentences) {
    words += s.split(/\s+/).filter((w) => w.length > 0).length;
  }
  return { avg: words / sentences.length, sentences: sentences.length };
}

function countFigures(text: string): number {
  const matches = text.match(/\$?\d[\d,.]*%?/g);
  return matches ? matches.length : 0;
}

function bandFor(score: number): VoiceBand {
  if (score >= STRONG_BAND) return "strong";
  if (score >= VOICE_BAR) return "adequate";
  return "weak";
}

// Evaluate an assembled layer's prose. Pure: same content in, same report out,
// with no clock, randomness, or I/O. The caller (the orchestrator) records the
// returned report on the layer row; nothing here mutates the content.
export function evaluateNarrativeVoice(content: LayerContent): VoiceReport {
  const prose = collectProse(content);
  const headlineText = [
    content.narrative,
    content.headline_finding,
    content.headline_impact,
    content.headline_lever,
  ].join("\n");

  const { avg, sentences } = avgSentenceWords(content.narrative);
  const hype = findPhrases(prose, HYPE_WORDS);
  const firstPerson = findPhrases(prose, FIRST_PERSON);
  const figures = countFigures(headlineText);
  const proofCount = content.proof.items.length;
  const gapCount = content.gaps.length;
  const hasLongDash = LONG_DASH.test(prose);

  const checks: VoiceCheck[] = [
    {
      id: "sentence_length",
      label: "Sentence length in a human band",
      passed: sentences > 0 && avg >= MIN_AVG_SENTENCE_WORDS && avg <= MAX_AVG_SENTENCE_WORDS,
      detail:
        sentences === 0
          ? "no sentences detected"
          : "avg " + avg.toFixed(1) + " words/sentence over " + String(sentences) + " sentences",
    },
    {
      id: "no_hype",
      label: "No marketing hype",
      passed: hype.length === 0,
      detail: hype.length === 0 ? "no hype words" : hype.length + " hype word(s): " + hype.join(", "),
    },
    {
      id: "no_first_person",
      label: "No first-person consultant voice",
      passed: firstPerson.length === 0,
      detail:
        firstPerson.length === 0
          ? "no first-person plural"
          : firstPerson.length + " marker(s): " + firstPerson.join(", "),
    },
    {
      id: "numeric_specificity",
      label: "Cites concrete figures",
      passed: figures >= MIN_NUMERIC_FIGURES,
      detail: String(figures) + " numeric figure(s) in narrative and headlines",
    },
    {
      id: "has_proof",
      label: "Backed by proof receipts",
      passed: proofCount >= 1,
      detail: String(proofCount) + " proof receipt(s)",
    },
    {
      id: "names_gaps",
      label: "Names at least one blind spot",
      passed: gapCount >= 1,
      detail: String(gapCount) + " gap(s) named",
    },
    {
      id: "no_long_dash",
      label: "No em or en dash",
      passed: !hasLongDash,
      detail: hasLongDash ? "a long dash is present" : "ascii hyphens only",
    },
  ];

  const passedCount = checks.reduce((n, c) => n + (c.passed ? 1 : 0), 0);
  const score = Math.round((100 * passedCount) / checks.length);

  return {
    score,
    band: bandFor(score),
    passed: score >= VOICE_BAR,
    checks,
  };
}
