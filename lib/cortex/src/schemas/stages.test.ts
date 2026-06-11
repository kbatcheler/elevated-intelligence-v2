// Schema tests for the stages that the engine cannot fake: the genuine
// Confounder output and the Evaluator score that owns confidence. If these
// drift, the persistence contract silently breaks.

import { describe, expect, it } from "vitest";
import {
  confounderOutputSchema,
  heroPanelSchema,
  perceiveOutputSchema,
  scoreOutputSchema,
  verifiedClaimSchema,
} from "./stages";

const validConfounder = {
  rank: 1,
  name: "Sector-wide demand softening",
  mechanism:
    "A macro pullback in the whole category depresses the headline metric independent of any company-specific execution gap.",
  directional_impact: "Pushes the metric down across all peers, not just this company.",
  verdict: "partial",
  reason: "Category indices fell over the same window, so some but not all of the decline is sector-driven.",
  source_urls: ["https://example.com/sector-report"],
};

describe("confounderOutputSchema", () => {
  it("accepts a ranked confounder with a grounded verdict", () => {
    const r = confounderOutputSchema.safeParse({ confounders: [validConfounder] });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown verdict", () => {
    const r = confounderOutputSchema.safeParse({
      confounders: [{ ...validConfounder, verdict: "confirmed" }],
    });
    expect(r.success).toBe(false);
  });

  it("requires at least one confounder", () => {
    const r = confounderOutputSchema.safeParse({ confounders: [] });
    expect(r.success).toBe(false);
  });

  it("requires the causal mechanism", () => {
    const { mechanism, ...withoutMechanism } = validConfounder;
    void mechanism;
    const r = confounderOutputSchema.safeParse({ confounders: [withoutMechanism] });
    expect(r.success).toBe(false);
  });
});

describe("array caps slice instead of rejecting overshoot", () => {
  it("slices a confounder's overflowing source_urls down to 8 rather than failing", () => {
    const manyUrls = Array.from({ length: 14 }, (_, i) => `https://example.com/source-${i}`);
    const r = confounderOutputSchema.safeParse({
      confounders: [{ ...validConfounder, source_urls: manyUrls }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.confounders[0]!.source_urls).toHaveLength(8);
  });

  it("slices an overflowing list of confounders down to the cap of 8", () => {
    const tooMany = Array.from({ length: 12 }, (_, i) => ({ ...validConfounder, rank: i + 1 }));
    const r = confounderOutputSchema.safeParse({ confounders: tooMany });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.confounders).toHaveLength(8);
  });

  it("slices a verified claim's overflowing source_urls but keeps the citation floor", () => {
    const manyUrls = Array.from({ length: 11 }, (_, i) => `https://example.com/cite-${i}`);
    const r = verifiedClaimSchema.safeParse({
      claim_text: "Wholesale revenue declined year over year.",
      claim_path: "causes[0]",
      source_urls: manyUrls,
      verified_by: "web-search",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source_urls).toHaveLength(8);
  });
});

describe("heroPanelSchema trend coercion", () => {
  const base = {
    metric_label: "DTC revenue share",
    metric_value: "61%",
    tone: "good",
    one_line_read: "Direct channel now carries the majority of revenue and is still climbing.",
  };

  it("pulls numeric tokens out of dirty trend values and drops non-numeric points", () => {
    const r = heroPanelSchema.safeParse({
      ...base,
      trend: [
        { label: "FY22", value: "48%" },
        { label: "FY23", value: "N/A" },
        { label: "FY24", value: "$1.2M" },
        { label: "FY25", value: 61 },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.trend).toEqual([
        { label: "FY22", value: 48 },
        { label: "FY24", value: 1.2 },
        { label: "FY25", value: 61 },
      ]);
    }
  });

  it("defaults trend to an empty array when the model omits it", () => {
    const r = heroPanelSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.trend).toEqual([]);
  });
});

describe("perceiveOutputSchema coercion", () => {
  const signal = {
    observation: "Direct-to-consumer revenue share grew while wholesale shrank over the last fiscal year.",
    evidence_type: "grounded",
    source_urls: ["https://example.com/report"],
  };

  it("coerces named_entities returned as objects into a flat string array", () => {
    const r = perceiveOutputSchema.safeParse({
      signals: [signal],
      named_entities: [
        { name: "Competitor A", type: "rival" },
        { entity: "Channel B" },
        "Plain string",
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.named_entities).toEqual(["Competitor A", "Channel B", "Plain string"]);
    }
  });

  it("coerces a single named_entities object into a one-item array", () => {
    const r = perceiveOutputSchema.safeParse({
      signals: [signal],
      named_entities: { name: "Sole Entity" },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.named_entities).toEqual(["Sole Entity"]);
  });
});

describe("verifiedClaimSchema coercion", () => {
  it("extracts URLs from objects the model wrapped them in", () => {
    const r = verifiedClaimSchema.safeParse({
      claim_text: "Wholesale revenue declined year over year.",
      claim_path: "causes[0]",
      source_urls: [{ url: "https://example.com/a" }, "https://example.com/b"],
      verified_by: "web-search",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.source_urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    }
  });

  it("rejects a verified claim with no citable source", () => {
    const r = verifiedClaimSchema.safeParse({
      claim_text: "Wholesale revenue declined year over year.",
      claim_path: "causes[0]",
      source_urls: [],
      verified_by: "web-search",
    });
    expect(r.success).toBe(false);
  });
});

describe("scoreOutputSchema", () => {
  it("caps overall confidence below certainty", () => {
    const r = scoreOutputSchema.safeParse({ confidence: 96, confidence_gap: 4 });
    expect(r.success).toBe(false);
  });

  it("accepts a valid score with per-claim annotations", () => {
    const r = scoreOutputSchema.safeParse({
      confidence: 72,
      confidence_gap: 18,
      gaps: [{ kind: "DATA", description: "No first-party churn feed", confidence_lift_pp: 10 }],
      claims: [
        { path: "causes[0]", confidence: 80, basis: "verified" },
        { path: "actions[1]", confidence: 55, basis: "modelled" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a claim basis outside verified|modelled", () => {
    const r = scoreOutputSchema.safeParse({
      confidence: 50,
      confidence_gap: 10,
      claims: [{ path: "causes[0]", confidence: 80, basis: "guessed" }],
    });
    expect(r.success).toBe(false);
  });
});
