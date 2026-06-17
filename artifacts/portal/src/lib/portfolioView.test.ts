import { describe, expect, it } from "vitest";
import type { GapSeverity } from "../types";
import { SEVERITY_COLOR, labelMissing } from "./portfolioView";

describe("portfolioView.SEVERITY_COLOR", () => {
  it("maps each gap severity to its accent without inventing a fourth", () => {
    const severities: GapSeverity[] = ["high", "medium", "low"];
    expect(severities.map((s) => SEVERITY_COLOR[s])).toEqual(["coral", "amber", "gray"]);
    expect(Object.keys(SEVERITY_COLOR)).toHaveLength(3);
  });
});

describe("portfolioView.labelMissing", () => {
  it("relabels the two known signal keys", () => {
    expect(labelMissing("layer_content")).toBe("diagnosis");
    expect(labelMissing("outcomes")).toBe("outcomes");
  });

  it("passes an unknown key through unchanged rather than dropping it", () => {
    expect(labelMissing("some_future_signal")).toBe("some_future_signal");
  });
});
