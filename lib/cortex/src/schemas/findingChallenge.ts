// Interactive Challenge (Phase AA) schemas. A challenge re-reasons ONE finding,
// not a whole layer: a compact Confounder re-examination followed by a compact
// Synthesist uphold-or-revise decision. These are deliberately separate from the
// nine layer-stage schemas (stages.ts) so a challenge can never widen into a
// layer rebuild.

import { z } from "zod/v4";
import { clampedStr } from "./atoms";

// The Confounder seat (Gemini, grounded) re-examines whether the user's
// objection introduces or strengthens a confounding explanation for THIS
// finding. It does not rewrite the finding; it returns a grounded note and a
// flag for whether a material confounder is now in play. The user's input is
// CONTEXT to test against evidence, never ground truth.
export const findingChallengeConfoundSchema = z.object({
  introduces_confounder: z.boolean(),
  note: clampedStr(1600, 3),
});
export type FindingChallengeConfound = z.infer<typeof findingChallengeConfoundSchema>;

// The verdict. "upheld" keeps the finding as it stands; "revised" attaches a new
// confidence. Neither can delete the finding.
export const findingChallengeOutcomeEnum = z.enum(["upheld", "revised"]);
export type FindingChallengeOutcome = z.infer<typeof findingChallengeOutcomeEnum>;

// The Synthesist seat (Claude) decides uphold-or-revise for the finding. The
// user's input is CONTEXT, never an override. revised_confidence is capped at 95
// (the engine never asserts certainty) and is meaningful only on a revise; the
// caller treats a "revised" verdict with no revised_confidence as malformed
// rather than fabricating a number.
export const findingChallengeDecisionSchema = z.object({
  outcome: findingChallengeOutcomeEnum,
  reasoning: clampedStr(2400, 5),
  revised_confidence: z.number().min(0).max(95).optional(),
});
export type FindingChallengeDecision = z.infer<typeof findingChallengeDecisionSchema>;
