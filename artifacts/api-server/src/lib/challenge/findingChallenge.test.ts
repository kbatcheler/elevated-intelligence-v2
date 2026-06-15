import { describe, expect, it } from "vitest";
import { layerContentSchema } from "@workspace/cortex";
import {
  canonicalFindingText,
  currentFindingHash,
  extractFinding,
  findingHash,
  parseFindingRef,
} from "./findingChallenge";

// A valid stored layer content used across the pure-helper tests. Every claim
// carries the confidence + basis the stored schema requires.
const raw = {
  narrative: "This is a narrative long enough to satisfy the minimum length floor.",
  headline_finding: "Headline finding",
  headline_impact: "Impact",
  headline_lever: "Lever text",
  causes: [
    { title: "Cause one", impact: "Impact one", detail: "Detail one", confidence: 78, basis: "modelled" },
    { title: "Cause two", impact: "Impact two", detail: "Detail two", confidence: 60, basis: "verified" },
  ],
  actions: [{ title: "Action one", detail: "Do this", impact: "Recover X", confidence: 70, basis: "modelled" }],
  hypotheses: [
    {
      statement: "Hypothesis statement here",
      supportingSignals: "supporting signals",
      alternativeExplanation: "an alternative",
      confidence: 55,
      basis: "modelled",
    },
  ],
  proof: { items: [] },
  gaps: [],
  metrics: [{ label: "Metric A", value: "42", sub: "subtext", tone: "good", confidence: 80, basis: "verified" }],
  confidence: 72,
  confidence_gap: 10,
};

const content = layerContentSchema.parse(raw);

describe("parseFindingRef", () => {
  it("parses each challengeable kind and index", () => {
    expect(parseFindingRef("causes[0]")).toEqual({ kind: "causes", index: 0 });
    expect(parseFindingRef("actions[3]")).toEqual({ kind: "actions", index: 3 });
    expect(parseFindingRef("hypotheses[2]")).toEqual({ kind: "hypotheses", index: 2 });
    expect(parseFindingRef("metrics[1]")).toEqual({ kind: "metrics", index: 1 });
  });

  it("rejects any other shape so a route can answer 400", () => {
    for (const bad of [
      "",
      "causes",
      "causes[]",
      "causes[-1]",
      "gaps[0]",
      "causes[0",
      "causes[0].title",
      "metric[0]",
      " causes[0]",
    ]) {
      expect(parseFindingRef(bad)).toBeNull();
    }
  });
});

describe("extractFinding", () => {
  it("normalises a cause onto the shared shape", () => {
    const f = extractFinding(content, { kind: "causes", index: 0 }, "causes[0]");
    expect(f).toEqual({
      ref: "causes[0]",
      kind: "cause",
      title: "Cause one",
      impact: "Impact one",
      detail: "Detail one",
      confidence: 78,
      basis: "modelled",
    });
  });

  it("maps a hypothesis statement to title", () => {
    const f = extractFinding(content, { kind: "hypotheses", index: 0 }, "hypotheses[0]");
    expect(f?.kind).toBe("hypothesis");
    expect(f?.title).toBe("Hypothesis statement here");
  });

  it("maps a metric label to title and value to impact", () => {
    const f = extractFinding(content, { kind: "metrics", index: 0 }, "metrics[0]");
    expect(f).toMatchObject({ kind: "metric", title: "Metric A", impact: "42", detail: "subtext" });
  });

  it("returns null for an out-of-range index", () => {
    expect(extractFinding(content, { kind: "causes", index: 9 }, "causes[9]")).toBeNull();
  });
});

describe("canonicalFindingText", () => {
  it("serialises with a fixed key order, omitting undefined fields", () => {
    const f = extractFinding(content, { kind: "causes", index: 0 }, "causes[0]")!;
    expect(canonicalFindingText(f)).toBe(
      JSON.stringify({
        ref: "causes[0]",
        kind: "cause",
        title: "Cause one",
        impact: "Impact one",
        detail: "Detail one",
        confidence: 78,
        basis: "modelled",
      }),
    );
  });
});

describe("findingHash", () => {
  it("is a deterministic 64-hex sha256", () => {
    expect(findingHash("abc")).toBe(findingHash("abc"));
    expect(findingHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(findingHash("abc")).not.toBe(findingHash("abd"));
  });
});

describe("currentFindingHash", () => {
  it("hashes the live finding, matching the manual canonical hash", () => {
    const f = extractFinding(content, { kind: "causes", index: 0 }, "causes[0]")!;
    expect(currentFindingHash(content, "causes[0]")).toBe(findingHash(canonicalFindingText(f)));
  });

  it("returns null for a ref that is not a challengeable kind", () => {
    expect(currentFindingHash(content, "gaps[0]")).toBeNull();
  });

  it("returns null when the content does not parse", () => {
    expect(currentFindingHash({ not: "a layer" }, "causes[0]")).toBeNull();
  });

  it("changes when the finding's content changes, binding a challenge to a version", () => {
    const changed = layerContentSchema.parse({
      ...raw,
      causes: [{ ...raw.causes[0], title: "A materially different cause" }, raw.causes[1]],
    });
    expect(currentFindingHash(changed, "causes[0]")).not.toBe(currentFindingHash(content, "causes[0]"));
  });
});
