import { describe, expect, it } from "vitest";
import {
  countClaimItems,
  countObjectArray,
  diffLayerSummaries,
  type AsOfLayerSummary,
} from "./asOfMath";

// Pure as-of diff math, pinned by hand-worked examples and no database. The one
// rule it must never break: a delta is a number only when BOTH sides carry the
// figure, otherwise it is null (the surface says "unavailable", never implies a
// move from or to zero).

function summary(over: Partial<AsOfLayerSummary> = {}): AsOfLayerSummary {
  return {
    contentHash: "hash-a",
    verifiedCount: 1,
    modelledCount: 2,
    confounderCount: 0,
    efficacyScore: 70,
    confidenceValue: 0.6,
    ...over,
  };
}

describe("countClaimItems", () => {
  it("counts only object items in a claims blob", () => {
    expect(countClaimItems({ items: [{}, {}, "x", null, 3] })).toBe(2);
  });
  it("treats a missing or non-array items field as zero", () => {
    expect(countClaimItems({ items: "nope" })).toBe(0);
    expect(countClaimItems(null)).toBe(0);
    expect(countClaimItems({})).toBe(0);
  });
});

describe("countObjectArray", () => {
  it("counts only object entries, ignoring null and scalars", () => {
    expect(countObjectArray([{}, null, 1, {}, "x"])).toBe(2);
  });
  it("treats a non-array as zero", () => {
    expect(countObjectArray(null)).toBe(0);
    expect(countObjectArray({})).toBe(0);
  });
});

describe("diffLayerSummaries", () => {
  it("reports no comparison when there is no current build", () => {
    const d = diffLayerSummaries(summary(), null);
    expect(d.hasCurrent).toBe(false);
    expect(d.contentChanged).toBeNull();
    expect(d.efficacyDelta).toBeNull();
    expect(d.confidenceDelta).toBeNull();
    expect(d.verifiedDelta).toBeNull();
  });

  it("reports a current build that did not exist at the as-of date", () => {
    const d = diffLayerSummaries(null, summary());
    expect(d.hasCurrent).toBe(true);
    // Nothing to compare a present current against an absent as-of, so all null.
    expect(d.contentChanged).toBeNull();
    expect(d.efficacyDelta).toBeNull();
  });

  it("computes current-minus-as-of deltas when both sides are present", () => {
    const asOf = summary({
      contentHash: "old",
      verifiedCount: 1,
      modelledCount: 2,
      confounderCount: 0,
      efficacyScore: 70,
      confidenceValue: 0.6,
    });
    const current = summary({
      contentHash: "new",
      verifiedCount: 3,
      modelledCount: 1,
      confounderCount: 1,
      efficacyScore: 80.5,
      confidenceValue: 0.72,
    });
    const d = diffLayerSummaries(asOf, current);
    expect(d.hasCurrent).toBe(true);
    expect(d.contentChanged).toBe(true);
    expect(d.efficacyDelta).toBe(10.5);
    expect(d.confidenceDelta).toBe(0.12);
    expect(d.verifiedDelta).toBe(2);
    expect(d.modelledDelta).toBe(-1);
    expect(d.confounderDelta).toBe(1);
  });

  it("calls content unchanged when the fingerprints match", () => {
    const d = diffLayerSummaries(summary({ contentHash: "same" }), summary({ contentHash: "same" }));
    expect(d.contentChanged).toBe(false);
    expect(d.efficacyDelta).toBe(0);
    expect(d.verifiedDelta).toBe(0);
  });

  it("leaves a derived delta null when that figure is absent on either side", () => {
    const asOf = summary({ efficacyScore: null, confidenceValue: 0.6 });
    const current = summary({ efficacyScore: 80, confidenceValue: null });
    const d = diffLayerSummaries(asOf, current);
    // Structural counts still diff; the derived figures with a null side do not.
    expect(d.efficacyDelta).toBeNull();
    expect(d.confidenceDelta).toBeNull();
    expect(d.verifiedDelta).toBe(0);
  });
});
