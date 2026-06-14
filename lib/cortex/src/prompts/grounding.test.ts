// Connected-mode grounding contract for the per-layer prompt builders.
//
// Two invariants are load-bearing for the V2 connector addendum:
//   1. outside_in is untouched. When no grounding is passed the builders must
//      emit the exact same user message as before the grounding parameter
//      existed, so the public-web seed path stays byte-for-byte identical.
//   2. connected mode grounds on math only. When grounding is passed the block
//      carries de-identified derived signals (scores, ratios, counts, embeddings
//      by dimension) and never a raw client record. Embeddings render as
//      vector[len], never dumped, so a reversible vector can never leak into a
//      prompt.

import { describe, expect, it } from "vitest";
import {
  buildChallenge,
  buildConfound,
  buildEnrichment,
  buildHypothesise,
  buildNarrate,
  buildPerceive,
  buildScore,
} from "./layerStages";
import type { LayerDescriptor, LayerGrounding } from "./shared";
import type { ProfileOutput } from "../schemas/profile";
import type {
  ChallengeOutput,
  ConfounderOutput,
  HypothesisedLayer,
  NarrateOutput,
  PerceiveOutput,
} from "../schemas/stages";

const profile: ProfileOutput = {
  name: "Acme Industrial",
  url: "https://acme.example",
  sector: "Industrial Manufacturing",
  logoMonogram: "AC",
};

const layer: LayerDescriptor = {
  key: "demand",
  name: "Demand",
  description: "How demand is forming across the pipeline.",
  diagnosticQuestion: "Is demand strengthening or softening, and why?",
};

// A grounding payload that exercises every render branch: a scalar with a unit
// and full provenance, a bare scalar, and an embedding that must NOT be dumped.
const grounding: LayerGrounding = {
  layerKey: "demand",
  signals: [
    {
      signalKey: "pipeline_velocity_ratio",
      value: 1.42,
      unit: "x",
      window: "90d",
      sourceConnectorKey: "crm",
      computedAt: "2026-06-01T00:00:00Z",
    },
    { signalKey: "win_rate", value: 0.31 },
    { signalKey: "account_embedding", value: [0.11, 0.22, 0.33, 0.44] },
  ],
};

const perceive = { signals: [], named_entities: [], sector_context: "" } as unknown as PerceiveOutput;
const hypothesised = { content: {} } as unknown as HypothesisedLayer;
const confounders = { confounders: [] } as unknown as ConfounderOutput;
const challenge = { claim_checks: [] } as unknown as ChallengeOutput;
const narrate = { content: {}, verified_claims: [], modelled_claims: [] } as unknown as NarrateOutput;

describe("connected-mode grounding (outside_in invariant)", () => {
  it("perceive user prompt is unchanged when no grounding is supplied", () => {
    const withArg = buildPerceive(profile, layer, undefined).user;
    const withoutArg = buildPerceive(profile, layer).user;
    expect(withArg).toBe(withoutArg);
    // Exact legacy shape: header, blank line, the search instruction. Nothing else.
    const expected = [
      "LAYER: Demand",
      "WHAT THIS LAYER EXAMINES: How demand is forming across the pipeline.",
      "DIAGNOSTIC QUESTION THIS LAYER MUST ANSWER: Is demand strengthening or softening, and why?",
      "",
      "Search the web first, then answer.",
    ].join("\n");
    expect(withoutArg).toBe(expected);
    expect(withoutArg).not.toContain("GROUNDING SIGNALS");
  });

  it("every per-layer builder omits the grounding block in outside_in mode", () => {
    const users = [
      buildPerceive(profile, layer).user,
      buildHypothesise(profile, layer, perceive).user,
      buildConfound(profile, layer, hypothesised).user,
      buildChallenge(profile, layer, hypothesised, confounders).user,
      buildNarrate(profile, layer, hypothesised, confounders, challenge).user,
      buildScore(profile, layer, narrate, confounders, challenge).user,
      buildEnrichment(profile, layer, narrate).user,
    ];
    for (const user of users) expect(user).not.toContain("GROUNDING SIGNALS");
  });

  it("an empty signal list produces no grounding block", () => {
    const user = buildPerceive(profile, layer, { layerKey: "demand", signals: [] }).user;
    expect(user).not.toContain("GROUNDING SIGNALS");
  });
});

describe("connected-mode grounding (math-only invariant)", () => {
  it("appends the derived-signal block to the perceive user prompt", () => {
    const user = buildPerceive(profile, layer, grounding).user;
    expect(user).toContain("GROUNDING SIGNALS");
    expect(user).toContain("pipeline_velocity_ratio = 1.42 x");
    expect(user).toContain("window 90d");
    expect(user).toContain("source crm");
    expect(user).toContain("computed 2026-06-01T00:00:00Z");
    expect(user).toContain("win_rate = 0.31");
  });

  it("renders embeddings by dimension and never dumps the vector", () => {
    const user = buildPerceive(profile, layer, grounding).user;
    expect(user).toContain("account_embedding = vector[4]");
    // Not one component of the embedding may appear verbatim in the prompt.
    expect(user).not.toContain("0.11");
    expect(user).not.toContain("0.22");
    expect(user).not.toContain("0.33");
    expect(user).not.toContain("0.44");
  });

  it("threads grounding through every per-layer builder", () => {
    const users = [
      buildPerceive(profile, layer, grounding).user,
      buildHypothesise(profile, layer, perceive, grounding).user,
      buildConfound(profile, layer, hypothesised, grounding).user,
      buildChallenge(profile, layer, hypothesised, confounders, grounding).user,
      buildNarrate(profile, layer, hypothesised, confounders, challenge, grounding).user,
      buildScore(profile, layer, narrate, confounders, challenge, grounding).user,
      buildEnrichment(profile, layer, narrate, grounding).user,
    ];
    for (const user of users) {
      expect(user).toContain("GROUNDING SIGNALS");
      expect(user).toContain("account_embedding = vector[4]");
      expect(user).not.toContain("0.22");
    }
  });

  it("keeps the cached system block identical whether or not grounding is present", () => {
    // The system blocks are the cache-stable prefix. Grounding rides ONLY in the
    // user turn, so the system text must not move when grounding is supplied.
    expect(buildPerceive(profile, layer, grounding).system).toEqual(
      buildPerceive(profile, layer).system,
    );
    expect(buildConfound(profile, layer, hypothesised, grounding).system).toEqual(
      buildConfound(profile, layer, hypothesised).system,
    );
  });
});
