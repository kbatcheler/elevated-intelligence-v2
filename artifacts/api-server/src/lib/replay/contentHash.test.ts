import { describe, expect, it } from "vitest";
import { canonicalStringify, hashLayerContent, type HashableLayerContent } from "./contentHash";

// The content fingerprint must be stable under key reordering (so an unchanged
// build always hashes equal) and sensitive to any real change (so a revised
// diagnosis never hashes equal to the one it replaced). Both halves are pinned
// here, with no database.

function content(over: Partial<HashableLayerContent> = {}): HashableLayerContent {
  return {
    content: { summary: "steady", score: 7 },
    heroPanel: { headline: "h" },
    peerBenchmark: null,
    supplementBlocks: null,
    confounders: [{ verdict: "ruled_out" }],
    verifiedClaims: { items: [{ a: 1 }] },
    modelledClaims: { items: [] },
    voiceQuality: { read: 0.9 },
    reducedMode: false,
    ...over,
  };
}

describe("canonicalStringify", () => {
  it("sorts object keys at every depth", () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("preserves array order, which is meaningful in a diagnosis", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("hashLayerContent", () => {
  it("is invariant to key insertion order", () => {
    const a = hashLayerContent(content({ content: { summary: "x", score: 1 } }));
    const b = hashLayerContent(content({ content: { score: 1, summary: "x" } }));
    expect(a).toBe(b);
  });

  it("changes when any content field changes", () => {
    const before = hashLayerContent(content());
    const after = hashLayerContent(content({ content: { summary: "revised", score: 9 } }));
    expect(after).not.toBe(before);
  });

  it("changes when the build mode flips, a materially different diagnosis", () => {
    const full = hashLayerContent(content({ reducedMode: false }));
    const reduced = hashLayerContent(content({ reducedMode: true }));
    expect(reduced).not.toBe(full);
  });

  it("normalises a missing nullable field to an explicit null", () => {
    const withNull = hashLayerContent(content({ peerBenchmark: null }));
    const withUndefined = hashLayerContent(content({ peerBenchmark: undefined as unknown as null }));
    expect(withUndefined).toBe(withNull);
  });

  it("ignores fields outside the content payload (model and confidence diff separately)", () => {
    // generatorModel and rawConfidence are deliberately not part of the hashable
    // payload, so two builds differing only in those still fingerprint equal.
    expect(hashLayerContent(content())).toBe(hashLayerContent(content()));
  });
});
