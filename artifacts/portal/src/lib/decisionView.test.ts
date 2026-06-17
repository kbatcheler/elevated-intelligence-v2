import { describe, expect, it } from "vitest";
import { basisOf, decisionErrorText } from "./decisionView";

describe("decisionView.decisionErrorText", () => {
  it("gives distinct human copy for each known decision error code", () => {
    expect(decisionErrorText("invalid_input")).toContain("rationale");
    expect(decisionErrorText("forbidden")).toContain("cannot record");
    expect(decisionErrorText("action_not_found")).toContain("no longer present");
    expect(decisionErrorText("layer_not_found")).toContain("no longer available");
    expect(decisionErrorText("not_an_action")).toContain("recommended action");
  });

  it("falls back to the generic failure message for an unknown code", () => {
    expect(decisionErrorText("???")).toBe("The decision could not be recorded. Try again.");
    expect(decisionErrorText("failed")).toBe("The decision could not be recorded. Try again.");
  });
});

describe("decisionView.basisOf", () => {
  it("treats only the exact 'verified' string as verified", () => {
    expect(basisOf("verified")).toBe("verified");
  });

  it("treats anything else as modelled rather than trusting it as verified", () => {
    expect(basisOf("modelled")).toBe("modelled");
    expect(basisOf("Verified")).toBe("modelled");
    expect(basisOf("")).toBe("modelled");
  });
});
