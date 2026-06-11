// Assemble the stored layer content by copying the Evaluator's per-claim
// confidence and basis onto the Synthesist's content. The Evaluator is the
// single writer of confidence and basis: every number here originates from
// score. Items the Evaluator did not annotate inherit the overall confidence
// and a modelled basis, which is still score's value rather than an invention.

import { layerContentSchema, type LayerContent } from "../schemas/content";
import type { Basis } from "../schemas/atoms";
import type { NarrateOutput, ScoreOutput } from "../schemas/stages";

export type AssembleResult =
  | { ok: true; content: LayerContent }
  | { ok: false; reason: string };

export function assembleLayerContent(narrate: NarrateOutput, score: ScoreOutput): AssembleResult {
  const c = narrate.content;
  const annotations = new Map<string, { confidence: number; basis: Basis }>();
  for (const claim of score.claims) {
    annotations.set(claim.path.replace(/\s+/g, ""), { confidence: claim.confidence, basis: claim.basis });
  }

  const overall = score.confidence;
  const annotate = (arr: string, i: number): { confidence: number; basis: Basis } =>
    annotations.get(`${arr}[${i}]`) ?? { confidence: overall, basis: "modelled" };

  const candidate = {
    narrative: c.narrative,
    headline_finding: c.headline_finding,
    headline_impact: c.headline_impact,
    headline_lever: c.headline_lever,
    causes: c.causes.map((x, i) => ({ ...x, ...annotate("causes", i) })),
    actions: c.actions.map((x, i) => ({ ...x, ...annotate("actions", i) })),
    hypotheses: (c.hypotheses ?? []).map((x, i) => ({ ...x, ...annotate("hypotheses", i) })),
    proof: c.proof,
    gaps: score.gaps,
    metrics: c.metrics.map((x, i) => ({ ...x, ...annotate("metrics", i) })),
    confidence: score.confidence,
    confidence_gap: score.confidence_gap,
  };

  const parsed = layerContentSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: `assembled content failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  return { ok: true, content: parsed.data };
}
