// Phase AF sovereign-mode honesty calibration. In sovereign mode no external
// verification channel runs: there is no Anthropic web search at perceive and no
// Gemini grounded challenge at confound/challenge, because every stage executes
// in-boundary on the local seat. A claim therefore can never be honestly
// "verified": it is the local model's own reasoning over the data it was given.
//
// These two pure transforms enforce that honesty at the orchestrator boundary,
// before anything is persisted or surfaced:
//
//   applySovereignNarrateCalibration downgrades every verified claim the
//   Synthesist emitted into a modelled claim (merging by claim_path so a path
//   already modelled is not duplicated), so the stored verifiedClaims array and
//   the provenance ledger never record an unverifiable claim as verified.
//
//   applySovereignScoreCalibration downgrades any per-claim basis the Evaluator
//   marked "verified" to "modelled", so the assembled, displayed content never
//   shows a verified badge in sovereign mode.
//
// Both are NO-OPs in outside_in and connected mode (groundingAvailable is true
// there, because the external channels really did run), so those paths stay
// byte-for-byte unchanged. They never invent, delete, or reorder a claim; they
// only relabel an over-claimed provenance down to the honest one.

import { groundingAvailable, type CortexDataMode } from "../config";
import type { ModelledClaim, NarrateOutput, ScoreOutput } from "../schemas/stages";

// The honest rationale recorded on a claim that the model asserted as verified
// but which no external channel could verify in sovereign mode.
export const SOVEREIGN_UNVERIFIED_RATIONALE =
  "asserted by the in-boundary model; no external verification channel was available in sovereign mode";

export function applySovereignNarrateCalibration(
  narrate: NarrateOutput,
  dataMode: CortexDataMode,
): NarrateOutput {
  if (groundingAvailable(dataMode)) return narrate;
  if (narrate.verified_claims.length === 0) return narrate;

  const seenPaths = new Set(narrate.modelled_claims.map((m) => m.claim_path));
  const downgraded: ModelledClaim[] = [];
  for (const vc of narrate.verified_claims) {
    if (seenPaths.has(vc.claim_path)) continue;
    seenPaths.add(vc.claim_path);
    downgraded.push({
      claim_text: vc.claim_text,
      claim_path: vc.claim_path,
      rationale: SOVEREIGN_UNVERIFIED_RATIONALE,
      consistency: "unknown",
      source_urls: vc.source_urls,
    });
  }

  return {
    ...narrate,
    verified_claims: [],
    modelled_claims: [...narrate.modelled_claims, ...downgraded],
  };
}

export function applySovereignScoreCalibration(score: ScoreOutput, dataMode: CortexDataMode): ScoreOutput {
  if (groundingAvailable(dataMode)) return score;
  if (!score.claims.some((c) => c.basis === "verified")) return score;
  return {
    ...score,
    claims: score.claims.map((c) => (c.basis === "verified" ? { ...c, basis: "modelled" as const } : c)),
  };
}
