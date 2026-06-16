// On-demand pre-mortem (Phase AL) schema. A pre-mortem imagines a single
// decision has already failed and reasons backwards: a ranked set of failure
// modes, each with the mechanism by which it would sink the decision and ONE
// observable early-warning indicator that would show it taking hold. It reuses
// the Confounder seat (the adversarial role) but is its own compact schema,
// deliberately separate from the nine layer-stage schemas (stages.ts) so a
// pre-mortem can never widen into a layer rebuild.

import { z } from "zod/v4";
import { cappedArray, clampedStr } from "./atoms";

// How likely the Confounder judges this failure mode, qualitatively. A
// pre-mortem is a structured imagination of failure, not a measured forecast, so
// the likelihood is a band rather than a fabricated probability; the Brier-scored
// forecast ledger (Phase AJ) remains the only place a probability is asserted.
export const preMortemLikelihoodEnum = z.enum(["low", "medium", "high"]);
export type PreMortemLikelihood = z.infer<typeof preMortemLikelihoodEnum>;

// One ranked way the decision could fail. early_warning is the single observable
// sign that the failure mode is taking hold; it becomes a watched
// pre_mortem_indicator the push evaluator can surface.
export const preMortemFailureModeSchema = z.object({
  rank: z.number().int().min(1).max(20),
  title: clampedStr(200, 3),
  mechanism: clampedStr(1400, 5),
  likelihood: preMortemLikelihoodEnum,
  early_warning: clampedStr(400, 3),
});
export type PreMortemFailureMode = z.infer<typeof preMortemFailureModeSchema>;

export const preMortemOutputSchema = z.object({
  failure_modes: cappedArray(preMortemFailureModeSchema, 1, 8),
  residual_risk_note: clampedStr(1200).optional(),
});
export type PreMortemOutput = z.infer<typeof preMortemOutputSchema>;
