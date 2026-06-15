import { describe, expect, it } from "vitest";
import { isReducedLayer, PRIORITY_LAYER_KEYS } from "./reduceDecision";

// Pure-function coverage for the reduced express-chain decision. The orchestrator
// uses this single predicate to decide whether a layer skips the two adversarial
// sub-stages (confound, challenge). The sovereign contract is the load-bearing
// case: a sovereign run must NEVER reduce, because every stage runs in-boundary.

const PRIORITY = "business-performance";
const NON_PRIORITY = "some-other-layer";

describe("isReducedLayer", () => {
  it("full mode never reduces, on any layer or data mode", () => {
    for (const dataMode of ["outside_in", "connected", "sovereign"] as const) {
      expect(isReducedLayer("full", PRIORITY, dataMode)).toBe(false);
      expect(isReducedLayer("full", NON_PRIORITY, dataMode)).toBe(false);
    }
  });

  it("express mode reduces only non-priority layers in outside_in and connected", () => {
    for (const dataMode of ["outside_in", "connected"] as const) {
      expect(isReducedLayer("express", NON_PRIORITY, dataMode)).toBe(true);
      expect(isReducedLayer("express", PRIORITY, dataMode)).toBe(false);
    }
  });

  it("sovereign mode never reduces, even express on a non-priority layer", () => {
    // The whole pipeline runs in-boundary on the local seat in sovereign mode, so
    // confound and challenge always run; the reduced express skip never applies.
    expect(isReducedLayer("express", NON_PRIORITY, "sovereign")).toBe(false);
    expect(isReducedLayer("express", PRIORITY, "sovereign")).toBe(false);
    expect(isReducedLayer("full", NON_PRIORITY, "sovereign")).toBe(false);
  });

  it("every priority key is honoured in express mode (no reduction)", () => {
    for (const key of PRIORITY_LAYER_KEYS) {
      expect(isReducedLayer("express", key, "outside_in")).toBe(false);
    }
  });
});
