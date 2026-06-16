import { describe, expect, it } from "vitest";
import {
  renderDiligencePackHtml,
  type DiligencePackData,
} from "./pack";
import type { DecisionTimelineEntry } from "../decisions/timeline";

// The pack render is a PURE function of an assembled DiligencePackData (the
// data assembly itself is exercised against a real database by the route and the
// services it calls). Rendering it in isolation lets the honesty boundary, the
// HTML escaping, and the decision pills be asserted deterministically without a
// database, and guards the exact status-string contract between the decision
// timeline and the pack: deriveOverruledStatus emits "right"/"wrong"/"pending",
// so the pill must key off those, not a prefixed variant.

function overruledEntry(): DecisionTimelineEntry {
  return {
    id: "d1",
    decidedAt: "2026-05-01T00:00:00.000Z",
    decision: "reject",
    layerKey: "growth",
    actionRef: null,
    recommendedTitle: "Launch <campaign>",
    recommendedDetail: null,
    recommendedImpact: null,
    recommendedValueUsd: 50000,
    systemConfidence: 0.8,
    systemBasis: "verified signals",
    recommendationVerified: true,
    evidenceRefs: [{ claimPath: "growth.x", contentHash: "h1" }],
    contradictsRecommendation: true,
    rationale: "Board chose to wait",
    decidedByEmail: "owner@example.com",
    provenanceContentHash: "ph1",
    committedActionId: null,
    actionStatus: null,
    realizedValueUsd: null,
    measurementStatus: null,
    forecastId: "f1",
    forecastProbability: 0.7,
    forecastResolved: true,
    forecastOutcome: 0,
    forecastBrierScore: 0.1,
    overruledStatus: "right",
    preMortems: [],
    cumulativeRealizedValueUsd: 0,
  };
}

function packData(overrides?: Partial<DiligencePackData>): DiligencePackData {
  return {
    brand: { product: "Different Day", poweredBy: "Powered by Elevated Intelligence" },
    tenant: { id: "t1", name: "Acme <Corp>", dataMode: "outside_in" },
    generatedAt: "2026-06-01T00:00:00.000Z",
    provenance: { ok: true, length: 3, brokenAt: null, detail: null },
    efficacy: { rollupScore: 62, rollupN: 2, modeCeiling: 60, dataMode: "outside_in" },
    calibration: {
      meanBrier: 0.12,
      n: 5,
      label: "provisional",
      beatsBaseline: true,
      baseline: 0.25,
      openCount: 2,
    },
    layers: [
      {
        layerKey: "growth",
        layerName: "Growth Engine",
        generated: true,
        reducedMode: false,
        generatedAt: "2026-05-01T00:00:00.000Z",
        headline: "Growth headline",
        verifiedCount: 4,
        modelledCount: 2,
        efficacyScore: 62,
        confidenceRaw: 80,
        confidenceAdjusted: 70,
        confidenceApplied: true,
        confidenceLabel: "well calibrated",
      },
    ],
    decisions: { entries: [overruledEntry()], summary: dummySummary() },
    outcomes: {
      totalIdentifiedValueUsd: 50000,
      totalRealizedValueUsd: 0,
      commits: 0,
      overruledRight: 1,
      overruledWrong: 0,
      overruledPending: 0,
    },
    ...overrides,
  };
}

function dummySummary(): DiligencePackData["decisions"]["summary"] {
  return {
    totalDecisions: 1,
    commits: 0,
    defers: 0,
    rejects: 1,
    overruledRight: 1,
    overruledWrong: 0,
    overruledPending: 0,
    totalIdentifiedValueUsd: 50000,
    totalRealizedValueUsd: 0,
  };
}

describe("renderDiligencePackHtml", () => {
  it("renders the brand frame and the honest read-only export note", () => {
    const html = renderDiligencePackHtml(packData());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Different Day Diligence Pack");
    expect(html).toContain("Powered by Elevated Intelligence");
    expect(html).toContain("read-only export of persisted state");
    expect(html).toContain("history cannot be edited through this");
  });

  it("labels verified beside modelled findings, never collapsing the distinction", () => {
    const html = renderDiligencePackHtml(packData());
    expect(html).toContain("4 verified");
    expect(html).toContain("2 modelled");
    expect(html).toContain("modelled findings are reasoned estimates");
  });

  it("renders the overruled pill off the timeline status contract", () => {
    // The exact regression guard: deriveOverruledStatus returns "right", and the
    // pill must render for it. A prefixed key ("overruled_right") would silently
    // drop the pill, hiding a board-grade outcome.
    const html = renderDiligencePackHtml(packData());
    expect(html).toContain("overruled and right");

    const wrong = packData();
    wrong.decisions.entries[0]!.overruledStatus = "wrong";
    expect(renderDiligencePackHtml(wrong)).toContain("overruled and wrong");

    const pending = packData();
    pending.decisions.entries[0]!.overruledStatus = "pending";
    expect(renderDiligencePackHtml(pending)).toContain("overruled, pending");

    // A decision that FOLLOWED the recommendation has a null status and no pill.
    const followed = packData();
    followed.decisions.entries[0]!.overruledStatus = null;
    const followedHtml = renderDiligencePackHtml(followed);
    expect(followedHtml).not.toContain("overruled and right");
    expect(followedHtml).not.toContain("overruled, pending");
  });

  it("escapes tenant-controlled strings so the export cannot inject markup", () => {
    const html = renderDiligencePackHtml(packData());
    expect(html).toContain("Acme &lt;Corp&gt;");
    expect(html).not.toContain("Acme <Corp>");
    expect(html).toContain("Launch &lt;campaign&gt;");
    expect(html).not.toContain("Launch <campaign>");
  });

  it("states the data-mode honestly and caps the efficacy ceiling for outside-in", () => {
    const out = renderDiligencePackHtml(packData());
    expect(out).toContain("Outside-in");
    expect(out).toContain("structurally capped");
    expect(out).toContain("Mode ceiling 60");

    const connected = renderDiligencePackHtml(
      packData({ tenant: { id: "t1", name: "Acme", dataMode: "connected" } }),
    );
    expect(connected).toContain("Connected (live connector signals)");
  });

  it("flags a broken provenance chain instead of asserting integrity", () => {
    const broken = renderDiligencePackHtml(
      packData({ provenance: { ok: false, length: 9, brokenAt: 4, detail: "hash mismatch" } }),
    );
    expect(broken).toContain("Provenance integrity FAILED at entry 4");
    expect(broken).toContain("hash mismatch");
    expect(broken).not.toContain("Provenance integrity verified");
  });
});
