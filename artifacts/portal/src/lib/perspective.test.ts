import { describe, expect, it } from "vitest";
import { orderByPerspective, perspectiveScore } from "./perspective";

// The real registry persona/order pairs, abbreviated to the two fields the lens
// reads. These mirror lib/db/src/seed/canonicalLayers.ts.
const LAYERS = [
  { key: "business-performance", ownerPersona: "CEO and the board", sortOrder: 1 },
  { key: "finance", ownerPersona: "CFO", sortOrder: 2 },
  { key: "demand-intelligence", ownerPersona: "CRO and CMO", sortOrder: 3 },
  { key: "competitive-intelligence", ownerPersona: "CEO and strategy", sortOrder: 4 },
  { key: "customer-intelligence", ownerPersona: "CRO and chief customer officer", sortOrder: 5 },
  { key: "brand-social", ownerPersona: "CMO", sortOrder: 6 },
  { key: "supply-chain", ownerPersona: "COO", sortOrder: 7 },
  { key: "pricing-margin", ownerPersona: "CFO and CRO", sortOrder: 8 },
  { key: "sales-pipeline", ownerPersona: "CRO and VP Sales", sortOrder: 9 },
  { key: "marketing-performance", ownerPersona: "CMO", sortOrder: 10 },
  { key: "people-operations", ownerPersona: "COO and CHRO", sortOrder: 11 },
  { key: "contract-management", ownerPersona: "CFO, general counsel, and COO", sortOrder: 12 },
  { key: "receivables", ownerPersona: "CFO and controller", sortOrder: 13 },
  { key: "talent-hr", ownerPersona: "CHRO", sortOrder: 14 },
];

describe("perspectiveScore", () => {
  it("scores by the highest-priority seat the persona names", () => {
    expect(perspectiveScore("COO", "operator")).toBeGreaterThan(perspectiveScore("CFO", "operator"));
    expect(perspectiveScore("CFO", "investor")).toBeGreaterThan(perspectiveScore("COO", "investor"));
    expect(perspectiveScore("CEO and the board", "board")).toBeGreaterThan(
      perspectiveScore("COO", "board"),
    );
  });

  it("returns zero when the lens speaks for none of the persona's seats", () => {
    expect(perspectiveScore("COO", "investor")).toBe(0);
    expect(perspectiveScore("CHRO", "investor")).toBe(0);
  });
});

describe("orderByPerspective", () => {
  it("does not add, drop, or mutate layers", () => {
    const out = orderByPerspective(LAYERS, "operator");
    expect(out).toHaveLength(LAYERS.length);
    expect(new Set(out.map((l) => l.key))).toEqual(new Set(LAYERS.map((l) => l.key)));
    expect(LAYERS[0].key).toBe("business-performance"); // input untouched
  });

  it("leads each lens with the layer its seats own", () => {
    expect(orderByPerspective(LAYERS, "operator")[0].key).toBe("supply-chain"); // COO
    expect(orderByPerspective(LAYERS, "investor")[0].key).toBe("finance"); // CFO
    expect(orderByPerspective(LAYERS, "board")[0].key).toBe("business-performance"); // board
  });

  it("breaks ties by registry sortOrder", () => {
    const sameScore = orderByPerspective(
      [
        { key: "b", ownerPersona: "CMO", sortOrder: 6 },
        { key: "a", ownerPersona: "CMO", sortOrder: 3 },
      ],
      "operator",
    );
    expect(sameScore.map((l) => l.key)).toEqual(["a", "b"]);
  });

  it("is deterministic across lenses (every lens returns the full set)", () => {
    for (const lens of ["operator", "investor", "board"] as const) {
      expect(orderByPerspective(LAYERS, lens)).toHaveLength(14);
    }
  });
});
