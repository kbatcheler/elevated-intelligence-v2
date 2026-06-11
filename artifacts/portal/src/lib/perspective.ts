import type { Perspective } from "../types";

// The perspective lens. It does not change a single figure; it only re-weights
// which layers lead, by reading the layer's registry ownerPersona. Each lens
// names the seats it speaks for, in priority order, and a layer scores by the
// highest-priority seat its persona mentions. Ties fall back to registry
// sortOrder, so the ordering is deterministic and purely a re-ranking of real
// registry fields.

const SEAT_PRIORITY: Record<Perspective, string[]> = {
  // The operator runs the business day to day: operations, revenue and people.
  operator: ["coo", "cro", "cmo", "vp sales", "chief customer officer", "controller", "chro"],
  // The investor reads financial performance, unit economics and the market.
  investor: ["cfo", "cro", "strategy", "controller", "ceo"],
  // The board governs: top-line health, strategy and legal or commercial risk.
  board: ["board", "ceo", "general counsel", "strategy", "cfo"],
};

// A layer's relevance to a lens: the rank of the first seat (highest priority
// first) the persona names, or zero when the lens speaks for none of its seats.
export function perspectiveScore(ownerPersona: string, perspective: Perspective): number {
  const persona = ownerPersona.toLowerCase();
  const seats = SEAT_PRIORITY[perspective];
  for (let i = 0; i < seats.length; i++) {
    if (persona.includes(seats[i])) return seats.length - i;
  }
  return 0;
}

// Re-rank layers for a lens: most relevant first, registry order breaking ties.
// Generic over any object carrying the two registry fields the lens reads, so it
// works for registry entries and for the tenant overview rows alike.
export function orderByPerspective<T extends { ownerPersona: string; sortOrder: number }>(
  layers: readonly T[],
  perspective: Perspective,
): T[] {
  return [...layers].sort((a, b) => {
    const diff = perspectiveScore(b.ownerPersona, perspective) - perspectiveScore(a.ownerPersona, perspective);
    return diff !== 0 ? diff : a.sortOrder - b.sortOrder;
  });
}

export const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  operator: "Operator",
  investor: "Investor",
  board: "Board",
};
