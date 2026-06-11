import { describe, expect, it } from "vitest";
import type { SignalLayer } from "../types";
import { deriveDependencyGraph, layoutNodes } from "./dependencyGraph";

function signal(partial: Partial<SignalLayer>): SignalLayer {
  return {
    key: "k",
    name: "K",
    moduleGroup: "",
    feeds: [],
    sortOrder: 1,
    ownerPersona: "",
    generated: true,
    headlineFinding: null,
    headlineImpact: null,
    headlineLever: null,
    confidence: null,
    confidenceGap: null,
    causes: [],
    actions: [],
    gaps: [],
    hypotheses: [],
    confounders: [],
    verifiedCount: 0,
    modelledCount: 0,
    generatedAt: null,
    generatorModel: null,
    ...partial,
  };
}

describe("deriveDependencyGraph", () => {
  it("links two layers in the same module group", () => {
    const a = signal({ key: "a", moduleGroup: "growth", sortOrder: 1 });
    const b = signal({ key: "b", moduleGroup: "growth", sortOrder: 2 });
    const { edges } = deriveDependencyGraph([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "a", target: "b", sharedModuleGroup: true });
  });

  it("links two layers that consume a shared feed", () => {
    const a = signal({ key: "a", moduleGroup: "x", feeds: ["ga4", "stripe"], sortOrder: 1 });
    const b = signal({ key: "b", moduleGroup: "y", feeds: ["stripe"], sortOrder: 2 });
    const { edges } = deriveDependencyGraph([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0].sharedModuleGroup).toBe(false);
    expect(edges[0].sharedFeeds).toEqual(["stripe"]);
  });

  it("draws no edge when neither module group nor feeds are shared", () => {
    const a = signal({ key: "a", moduleGroup: "x", feeds: ["ga4"], sortOrder: 1 });
    const b = signal({ key: "b", moduleGroup: "y", feeds: ["stripe"], sortOrder: 2 });
    expect(deriveDependencyGraph([a, b]).edges).toHaveLength(0);
  });

  it("ignores empty module groups so blank registry values never bond layers", () => {
    const a = signal({ key: "a", moduleGroup: "", feeds: [], sortOrder: 1 });
    const b = signal({ key: "b", moduleGroup: "", feeds: [], sortOrder: 2 });
    expect(deriveDependencyGraph([a, b]).edges).toHaveLength(0);
  });

  it("weights a node by the real sum of its gap confidence lift", () => {
    const a = signal({
      key: "a",
      gaps: [
        { kind: "DATA", description: "g1", closes: "c", confidenceLiftPp: 7 },
        { kind: "SIGNAL", description: "g2", closes: "c", confidenceLiftPp: 3 },
        { kind: "MODEL", description: "g3", closes: "c", confidenceLiftPp: null },
      ],
    });
    expect(deriveDependencyGraph([a]).nodes[0].weight).toBe(10);
  });

  it("keeps ungenerated layers as zero-weight nodes so edges never dangle", () => {
    const a = signal({ key: "a", moduleGroup: "g", generated: true, sortOrder: 1, gaps: [{ kind: "DATA", description: "x", closes: "c", confidenceLiftPp: 5 }] });
    const b = signal({ key: "b", moduleGroup: "g", generated: false, sortOrder: 2 });
    const graph = deriveDependencyGraph([a, b]);
    expect(graph.nodes.map((n) => n.key)).toEqual(["a", "b"]);
    expect(graph.nodes[1].weight).toBe(0);
    expect(graph.edges).toHaveLength(1);
  });

  it("returns nodes in registry sort order", () => {
    const a = signal({ key: "a", sortOrder: 3 });
    const b = signal({ key: "b", sortOrder: 1 });
    const c = signal({ key: "c", sortOrder: 2 });
    expect(deriveDependencyGraph([a, b, c]).nodes.map((n) => n.key)).toEqual(["b", "c", "a"]);
  });
});

describe("layoutNodes", () => {
  it("places the first node at the top of the circle and preserves count", () => {
    const nodes = deriveDependencyGraph([
      signal({ key: "a", sortOrder: 1 }),
      signal({ key: "b", sortOrder: 2 }),
      signal({ key: "c", sortOrder: 3 }),
      signal({ key: "d", sortOrder: 4 }),
    ]).nodes;
    const positioned = layoutNodes(nodes, { radius: 10, cx: 0, cy: 0 });
    expect(positioned).toHaveLength(4);
    expect(positioned[0].x).toBeCloseTo(0);
    expect(positioned[0].y).toBeCloseTo(-10);
    // Every node lands on the circle of the given radius.
    for (const p of positioned) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10);
    }
  });

  it("does not divide by zero on an empty node list", () => {
    expect(layoutNodes([])).toEqual([]);
  });
});
