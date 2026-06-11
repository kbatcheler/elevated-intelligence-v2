// Layer content schemas. Two shapes exist on purpose:
//
//   narrateContentSchema  - what the Synthesist (narrate) emits. It owns the
//                           prose and structure but NOT the per-claim numbers.
//   layerContentSchema    - the stored shape. Every claim carries a numeric
//                           confidence (0-100) and a basis (verified|modelled).
//                           These are written EXCLUSIVELY by the Evaluator
//                           (score); the orchestrator copies score's values
//                           onto narrate's content. No other stage writes them.
//
// Splitting the two keeps the writer of each field unambiguous and lets the
// content store stay strict about confidence/basis being present.

import { z } from "zod/v4";
import { basisEnum, cappedArray, clampedStr, gapSchema, toneEnum } from "./atoms";

// Per-claim annotation written by score.
const claimAnnotation = {
  confidence: z.number().min(0).max(100),
  basis: basisEnum,
};

// Proof receipts: where an observation came from.
const proofItemSchema = z.object({
  source: clampedStr(240),
  observation: clampedStr(1200),
});
const proofSchema = z
  .object({ items: cappedArray(proofItemSchema, 0, 12) })
  .optional()
  .default({ items: [] });

// ── Narrate (Synthesist) item shapes: prose and structure, no numbers ──
const narrateCause = z.object({
  title: clampedStr(300, 2),
  impact: clampedStr(500),
  detail: clampedStr(1400),
});
const narrateAction = z.object({
  title: clampedStr(300, 2),
  detail: clampedStr(1400),
  impact: clampedStr(500),
  timing: clampedStr(160).optional(),
  owner: clampedStr(160).optional(),
});
const narrateHypothesis = z.object({
  statement: clampedStr(600, 5),
  supportingSignals: clampedStr(1200).optional(),
  alternativeExplanation: clampedStr(1200).optional(),
});
const narrateMetric = z.object({
  label: clampedStr(160, 1),
  value: clampedStr(120, 1),
  sub: clampedStr(300).optional(),
  tone: toneEnum,
});

export const narrateContentSchema = z.object({
  narrative: clampedStr(6000, 20),
  headline_finding: clampedStr(600, 5),
  headline_impact: clampedStr(500, 2),
  headline_lever: clampedStr(600, 5),
  causes: cappedArray(narrateCause, 1, 8),
  actions: cappedArray(narrateAction, 1, 8),
  hypotheses: cappedArray(narrateHypothesis, 0, 8),
  proof: proofSchema,
  metrics: cappedArray(narrateMetric, 1, 8),
});
export type NarrateContent = z.infer<typeof narrateContentSchema>;

// ── Stored item shapes: same fields plus confidence + basis ──
const storedCause = narrateCause.extend(claimAnnotation);
const storedAction = narrateAction.extend(claimAnnotation);
const storedHypothesis = narrateHypothesis.extend(claimAnnotation);
const storedMetric = narrateMetric.extend(claimAnnotation);

export const layerContentSchema = z.object({
  narrative: clampedStr(6000, 20),
  headline_finding: clampedStr(600, 5),
  headline_impact: clampedStr(500, 2),
  headline_lever: clampedStr(600, 5),
  causes: cappedArray(storedCause, 1, 8),
  actions: cappedArray(storedAction, 1, 8),
  hypotheses: cappedArray(storedHypothesis, 0, 8),
  proof: proofSchema,
  gaps: cappedArray(gapSchema, 0, 12),
  metrics: cappedArray(storedMetric, 1, 8),
  // Overall layer confidence and the lift available by closing the gaps.
  confidence: z.number().min(0).max(100),
  confidence_gap: z.number().min(0).max(100),
});
export type LayerContent = z.infer<typeof layerContentSchema>;
