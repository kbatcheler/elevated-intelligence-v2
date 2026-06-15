// Phase AF: the sovereign-mode honesty calibration. These pure transforms relabel
// an over-claimed provenance down to the honest one in sovereign mode and are
// strict no-ops in outside_in and connected mode (where the external verification
// channels really did run). They never invent, delete, or reorder a claim.

import { describe, expect, it } from "vitest";
import {
  applySovereignNarrateCalibration,
  applySovereignScoreCalibration,
  SOVEREIGN_UNVERIFIED_RATIONALE,
} from "./calibration";
import type { NarrateOutput, ScoreOutput, VerifiedClaim, ModelledClaim } from "../schemas/stages";

function verifiedClaim(path: string): VerifiedClaim {
  return {
    claim_text: `verified text for ${path}`,
    claim_path: path,
    source_urls: ["https://src.example"],
    source_titles: ["Source"],
    verified_by: "web-search",
    reconciled: false,
  } as unknown as VerifiedClaim;
}

function modelledClaim(path: string): ModelledClaim {
  return {
    claim_text: `modelled text for ${path}`,
    claim_path: path,
    rationale: "pre-existing modelled rationale",
    consistency: "consistent",
    source_urls: [],
  } as unknown as ModelledClaim;
}

function narrateWith(verified: VerifiedClaim[], modelled: ModelledClaim[]): NarrateOutput {
  return { content: {}, verified_claims: verified, modelled_claims: modelled } as unknown as NarrateOutput;
}

function scoreWith(claims: ScoreOutput["claims"]): ScoreOutput {
  return { confidence: 50, confidence_gap: 0, gaps: [], claims } as unknown as ScoreOutput;
}

describe("applySovereignNarrateCalibration", () => {
  it("downgrades every verified claim to a modelled claim in sovereign mode", () => {
    const narrate = narrateWith([verifiedClaim("causes[0]"), verifiedClaim("actions[1]")], []);
    const out = applySovereignNarrateCalibration(narrate, "sovereign");
    // No claim survives as verified.
    expect(out.verified_claims).toHaveLength(0);
    // Both arrive as modelled, with the honest rationale and unknown consistency.
    expect(out.modelled_claims).toHaveLength(2);
    expect(out.modelled_claims.map((m) => m.claim_path).sort()).toEqual(["actions[1]", "causes[0]"]);
    for (const m of out.modelled_claims) {
      expect(m.rationale).toBe(SOVEREIGN_UNVERIFIED_RATIONALE);
      expect(m.consistency).toBe("unknown");
    }
  });

  it("merges by claim_path: a path already modelled is not duplicated", () => {
    const narrate = narrateWith([verifiedClaim("causes[0]")], [modelledClaim("causes[0]")]);
    const out = applySovereignNarrateCalibration(narrate, "sovereign");
    expect(out.verified_claims).toHaveLength(0);
    // The pre-existing modelled claim for causes[0] is kept; the verified one is
    // dropped rather than duplicating the path.
    expect(out.modelled_claims).toHaveLength(1);
    expect(out.modelled_claims[0]?.rationale).toBe("pre-existing modelled rationale");
  });

  it("is a no-op in connected and outside_in mode (verification really ran)", () => {
    const narrate = narrateWith([verifiedClaim("causes[0]")], []);
    expect(applySovereignNarrateCalibration(narrate, "connected")).toBe(narrate);
    expect(applySovereignNarrateCalibration(narrate, "outside_in")).toBe(narrate);
  });

  it("is a no-op in sovereign mode when there is nothing to downgrade", () => {
    const narrate = narrateWith([], [modelledClaim("causes[0]")]);
    expect(applySovereignNarrateCalibration(narrate, "sovereign")).toBe(narrate);
  });
});

describe("applySovereignScoreCalibration", () => {
  it("downgrades a per-claim basis from verified to modelled in sovereign mode", () => {
    const score = scoreWith([
      { path: "causes[0]", confidence: 70, basis: "verified" },
      { path: "actions[0]", confidence: 40, basis: "modelled" },
    ]);
    const out = applySovereignScoreCalibration(score, "sovereign");
    expect(out.claims.map((c) => c.basis)).toEqual(["modelled", "modelled"]);
    // Confidence values are untouched; only the basis label is relabelled.
    expect(out.claims.map((c) => c.confidence)).toEqual([70, 40]);
  });

  it("is a no-op in connected and outside_in mode", () => {
    const score = scoreWith([{ path: "causes[0]", confidence: 70, basis: "verified" }]);
    expect(applySovereignScoreCalibration(score, "connected")).toBe(score);
    expect(applySovereignScoreCalibration(score, "outside_in")).toBe(score);
  });

  it("is a no-op in sovereign mode when no claim is marked verified", () => {
    const score = scoreWith([{ path: "causes[0]", confidence: 40, basis: "modelled" }]);
    expect(applySovereignScoreCalibration(score, "sovereign")).toBe(score);
  });
});
