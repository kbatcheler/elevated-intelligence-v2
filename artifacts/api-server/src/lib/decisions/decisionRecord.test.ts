import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalRecommendation,
  recommendationHash,
  type RecommendationSnapshot,
} from "./decisionRecord";

// The recommendation snapshot binding (Phase AL). canonicalRecommendation is a
// fixed-key-order, null-omitting ASCII serialisation so a decision binds to the
// EXACT recommendation it acted on; recommendationHash is its sha256. Both are
// pure and unit tested without a database.

const snapshot: RecommendationSnapshot = {
  title: "Tighten dunning on failed renewals",
  detail: "Retry on day 1, 3 and 7 with escalating messaging.",
  impact: "Recovers about 18000 dollars per quarter",
  predictedValueUsd: 18000,
  confidence: 72,
  basis: "modelled",
};

describe("canonicalRecommendation", () => {
  it("serialises with a fixed key order and includes the action ref when present", () => {
    expect(canonicalRecommendation("actions[0]", snapshot)).toBe(
      JSON.stringify({
        actionRef: "actions[0]",
        title: snapshot.title,
        detail: snapshot.detail,
        impact: snapshot.impact,
        predictedValueUsd: 18000,
        confidence: 72,
        basis: "modelled",
      }),
    );
  });

  it("omits null fields and the action ref when absent", () => {
    expect(
      canonicalRecommendation(null, {
        title: "Do the thing",
        detail: null,
        impact: null,
        predictedValueUsd: null,
        confidence: 50,
        basis: "verified",
      }),
    ).toBe(JSON.stringify({ title: "Do the thing", confidence: 50, basis: "verified" }));
  });

  it("is canonical, not source order: a reordered snapshot yields the same string", () => {
    const reordered: RecommendationSnapshot = {
      basis: "modelled",
      confidence: 72,
      predictedValueUsd: 18000,
      impact: snapshot.impact,
      detail: snapshot.detail,
      title: snapshot.title,
    };
    expect(canonicalRecommendation("actions[0]", reordered)).toBe(
      canonicalRecommendation("actions[0]", snapshot),
    );
  });
});

describe("recommendationHash", () => {
  it("is the sha256 hex digest of the canonical string", () => {
    const canonical = canonicalRecommendation("actions[0]", snapshot);
    const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
    const hash = recommendationHash(canonical);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expected);
  });

  it("binds to the exact recommendation: any change to the snapshot changes the hash", () => {
    const base = recommendationHash(canonicalRecommendation("actions[0]", snapshot));
    const changed = recommendationHash(
      canonicalRecommendation("actions[0]", { ...snapshot, confidence: 73 }),
    );
    expect(changed).not.toBe(base);
  });
});
