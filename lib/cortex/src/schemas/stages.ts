// Per-stage output schemas. Every model call is validated against one of these
// before its result is allowed downstream. Intermediate stages (perceive,
// hypothesise, confound, challenge) annotate evidence with grounded|inferred;
// the final stored content uses verified|modelled, written only by score.

import { z } from "zod/v4";
import { VERIFICATION_CHANNELS } from "../config";
import {
  basisEnum,
  cappedArray,
  clampedStr,
  evidenceTypeEnum,
  gapSchema,
  looseStringArray,
  requiredUrlArray,
  toneEnum,
  urlArray,
} from "./atoms";
import { narrateContentSchema } from "./content";

// ── perceive (Lens, web_search) ──────────────────────────────────────────
export const perceiveSignalSchema = z.object({
  observation: clampedStr(1000, 5),
  relevance: clampedStr(600).optional(),
  evidence_type: evidenceTypeEnum,
  source_urls: urlArray,
});
export const perceiveOutputSchema = z.object({
  signals: cappedArray(perceiveSignalSchema, 1, 12),
  // Flat list of real entity names; tolerant of the model emitting { name, type }.
  named_entities: looseStringArray(200, 24),
  sector_context: clampedStr(2000).optional(),
});
export type PerceiveOutput = z.infer<typeof perceiveOutputSchema>;

// ── hypothesise (Lens) ───────────────────────────────────────────────────
const draftClaimSchema = z.object({
  statement: clampedStr(1200, 3),
  evidence_type: evidenceTypeEnum,
  source_urls: urlArray,
  confidence: z.number().min(0).max(100).optional(),
});
export const hypothesisedLayerSchema = z.object({
  headline_finding: clampedStr(600, 5),
  headline_impact: clampedStr(500, 2),
  candidate_causes: cappedArray(draftClaimSchema, 1, 8),
  candidate_actions: cappedArray(draftClaimSchema, 1, 8),
  hypotheses: cappedArray(
    z.object({
      statement: clampedStr(600, 5),
      supporting_signals: clampedStr(1200).optional(),
      alternative_explanation: clampedStr(1200).optional(),
      evidence_type: evidenceTypeEnum,
      source_urls: urlArray,
    }),
    1,
    8,
  ),
  open_questions: looseStringArray(400, 10),
});
export type HypothesisedLayer = z.infer<typeof hypothesisedLayerSchema>;

// ── confound (Confounder, grounded) ──────────────────────────────────────
// The genuine Confounder: alternative variables that could explain the
// headline finding, each grounded against the web and given a verdict.
export const confounderVerdictEnum = z.enum(["ruled_out", "partial", "unresolved"]);
export type ConfounderVerdict = z.infer<typeof confounderVerdictEnum>;

export const confounderSchema = z.object({
  rank: z.number().int().min(1).max(20),
  name: clampedStr(200, 2),
  // The causal mechanism by which this variable could produce the finding.
  mechanism: clampedStr(1200, 5),
  // Which way it pushes the headline metric if real.
  directional_impact: clampedStr(400, 2),
  verdict: confounderVerdictEnum,
  // Grounded reasoning behind the verdict.
  reason: clampedStr(1400, 5),
  source_urls: urlArray,
});
export type Confounder = z.infer<typeof confounderSchema>;

export const confounderOutputSchema = z.object({
  confounders: cappedArray(confounderSchema, 1, 8),
  residual_confidence_note: clampedStr(1000).optional(),
});
export type ConfounderOutput = z.infer<typeof confounderOutputSchema>;

// ── challenge (Challenger, grounded) ─────────────────────────────────────
export const challengeFindingSchema = z.object({
  claim_path: clampedStr(160, 1),
  claim_text: clampedStr(1200, 2),
  status: z.enum(["supported", "refuted", "uncertain"]),
  reason: clampedStr(1200, 3),
  source_urls: urlArray,
});
export const challengeOutputSchema = z.object({
  findings: cappedArray(challengeFindingSchema, 1, 16),
  alternative_hypotheses: looseStringArray(600, 8),
  overall_assessment: clampedStr(1200).optional(),
});
export type ChallengeOutput = z.infer<typeof challengeOutputSchema>;

// ── narrate (Synthesist) ─────────────────────────────────────────────────
export const verifiedClaimSchema = z.object({
  claim_text: clampedStr(1200, 2),
  claim_path: clampedStr(160, 1),
  source_urls: requiredUrlArray,
  source_titles: looseStringArray(400, 8),
  // Channel name, never a model identifier.
  verified_by: z.enum(VERIFICATION_CHANNELS),
  verified_at: clampedStr(40).optional(),
  reconciled: z.boolean().optional().default(false),
});
export type VerifiedClaim = z.infer<typeof verifiedClaimSchema>;

export const modelledClaimSchema = z.object({
  claim_text: clampedStr(1200, 2),
  claim_path: clampedStr(160, 1),
  rationale: clampedStr(1200).optional(),
  consistency: z.enum(["consistent", "tension", "unknown"]).optional().default("unknown"),
  source_urls: urlArray,
});
export type ModelledClaim = z.infer<typeof modelledClaimSchema>;

export const narrateOutputSchema = z.object({
  content: narrateContentSchema,
  verified_claims: cappedArray(verifiedClaimSchema, 0, 24),
  modelled_claims: cappedArray(modelledClaimSchema, 0, 24),
});
export type NarrateOutput = z.infer<typeof narrateOutputSchema>;

// ── score (Evaluator) ────────────────────────────────────────────────────
// The single writer of per-claim confidence + basis and overall confidence.
//
// The basis is tolerant at this input boundary: the Evaluator occasionally
// returns a basis outside the enum (for example "estimated" or "inferred") or
// omits it. Rather than failing the whole stage and spending a retry, coerce any
// unrecognised value to the conservative "modelled": an unknown provenance is
// never promoted to "verified". This mirrors how assemble.ts already treats an
// unannotated claim. The STORED content schema (content.ts) keeps basisEnum
// strict, so persisted data is still exactly verified|modelled.
const scoreClaimBasis = z.preprocess(
  (v) => (v === "verified" || v === "modelled" ? v : "modelled"),
  basisEnum,
);

export const scoreClaimSchema = z.object({
  // Item path into the content, e.g. "causes[0]", "actions[1]", "metrics[2]",
  // "hypotheses[0]".
  path: clampedStr(160, 1),
  confidence: z.number().min(0).max(100),
  basis: scoreClaimBasis,
});

// Phase AJ. What kind of binary-resolvable prediction a forecast is. Each one
// resolves true or false within its horizon: a recommended action realising its
// predicted impact, a flagged risk occurring, an anomaly proving material, a
// finding surviving scrutiny, or a Confounder verdict holding up under later
// evidence.
export const forecastKindEnum = z.enum([
  "action_outcome",
  "risk_occurrence",
  "anomaly_materiality",
  "finding_survival",
  "confounder_verdict",
]);
export type ForecastKind = z.infer<typeof forecastKindEnum>;

// The seat whose prediction a forecast belongs to, for the per-seat track
// record. A role label, never a model identifier. The Evaluator owns its layer
// forecasts; a confounder_verdict forecast is attributed to the Confounder whose
// verdict it scores.
export const forecastSeatEnum = z.preprocess(
  (v) => (v === "Confounder" ? "Confounder" : "Evaluator"),
  z.enum(["Evaluator", "Confounder"]),
);

// A single probabilistic forecast emitted by the real Evaluator call. The
// probability is a genuine likelihood in [0,1]; the orchestrator turns
// horizon_days into a concrete resolveBy timestamp at persistence time. No
// probability is ever synthesised from a verdict string or defaulted to a
// reflexive value: a layer with nothing objectively resolvable simply emits an
// empty list.
export const scoreForecastSchema = z.object({
  kind: forecastKindEnum,
  // The product role this forecast belongs to; defaults to the Evaluator.
  subject_seat: forecastSeatEnum.optional().default("Evaluator"),
  // The path into the content or confounders this forecast refers to, e.g.
  // "actions[0]" or "confounders[1]". Optional for a layer-level statement.
  source_path: clampedStr(160).optional(),
  // The plain-English statement that will resolve true or false.
  statement: clampedStr(600, 5),
  // The genuine probability the statement resolves TRUE, in [0,1].
  probability: z.number().min(0).max(1),
  // The horizon in days within which the statement should resolve.
  horizon_days: z.number().int().min(1).max(1095),
});
export type ScoreForecast = z.infer<typeof scoreForecastSchema>;

export const scoreOutputSchema = z.object({
  // Capped below 100: the engine never asserts certainty.
  confidence: z.number().min(0).max(95),
  confidence_gap: z.number().min(0).max(100),
  gaps: cappedArray(gapSchema, 0, 12),
  claims: cappedArray(scoreClaimSchema, 0, 48),
  // Phase AJ. The binary-resolvable forecasts this layer makes. Optional and
  // defaulted to empty so a layer with nothing objectively resolvable, and every
  // pre-AJ fixture, stays valid.
  forecasts: cappedArray(scoreForecastSchema, 0, 12).optional().default([]),
});
export type ScoreOutput = z.infer<typeof scoreOutputSchema>;

// ── hero (Enrichment) ────────────────────────────────────────────────────
export const heroPanelSchema = z.object({
  metric_label: clampedStr(160, 1),
  metric_value: clampedStr(120, 1),
  metric_sub: clampedStr(300).optional(),
  tone: toneEnum,
  one_line_read: clampedStr(600, 5),
  // Decorative sparkline. Models routinely emit non-numeric values ("12%",
  // "N/A", "$1.2M"); pull the first numeric token out of each point and drop any
  // point with no number or no usable label, rather than failing the whole hero
  // stage on a cosmetic sparkline.
  trend: z
    .preprocess((v) => {
      if (!Array.isArray(v)) return [];
      return v
        .map((p) => {
          const point = (p ?? {}) as { label?: unknown; value?: unknown };
          const match = String(point.value ?? "").match(/-?\d+(?:\.\d+)?/);
          const value = typeof point.value === "number" ? point.value : match ? Number(match[0]) : NaN;
          const label = point.label == null ? "" : String(point.label).trim();
          return { label, value };
        })
        .filter((p) => Number.isFinite(p.value) && p.label.length > 0)
        .slice(0, 12);
    }, z.array(z.object({ label: clampedStr(60, 1), value: z.number() })).max(12))
    .optional()
    .default([]),
});
export type HeroPanel = z.infer<typeof heroPanelSchema>;

// ── peers (Enrichment) ───────────────────────────────────────────────────
export const peerBenchmarkSchema = z.object({
  dimension: clampedStr(200, 2),
  unit: clampedStr(60).optional(),
  peers: cappedArray(
    z.object({
      name: clampedStr(160, 1),
      value: clampedStr(80).optional(),
      note: clampedStr(400).optional(),
      is_self: z.boolean().optional().default(false),
    }),
    2,
    10,
  ),
  read: clampedStr(800).optional(),
  source_urls: urlArray,
});
export type PeerBenchmark = z.infer<typeof peerBenchmarkSchema>;

// ── supplements (Enrichment) ─────────────────────────────────────────────
export const supplementBlockSchema = z.object({
  kind: z.enum(["context", "risk", "watchlist", "quote", "stat"]),
  title: clampedStr(200, 2),
  body: clampedStr(1600, 5),
  source_urls: urlArray,
});
export const supplementBlocksSchema = z.object({
  blocks: cappedArray(supplementBlockSchema, 1, 8),
});
export type SupplementBlocks = z.infer<typeof supplementBlocksSchema>;

// ── enrichment (Enrichment, batched) ─────────────────────────────────────
// hero, peers and supplements all take the same inputs and share the Evaluator
// seat, so they run as ONE Haiku call returning this composite. The
// orchestrator validates against this schema, then splits the result into three
// distinct persisted sub-stage records.
export const enrichmentOutputSchema = z.object({
  hero: heroPanelSchema,
  peers: peerBenchmarkSchema,
  supplements: supplementBlocksSchema,
});
export type EnrichmentOutput = z.infer<typeof enrichmentOutputSchema>;
