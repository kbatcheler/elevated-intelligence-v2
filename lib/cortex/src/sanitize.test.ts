import { describe, it, expect } from "vitest";

import { stripDashes, deepStripDashes } from "./sanitize";

describe("dash sanitizer", () => {
  it("replaces an em-dash with a spaced ASCII hyphen", () => {
    expect(stripDashes("three confounders\u2014suite consolidation")).toBe(
      "three confounders - suite consolidation",
    );
  });

  it("collapses surrounding whitespace around a spaced em-dash", () => {
    expect(stripDashes("revenue \u2014 margin")).toBe("revenue - margin");
  });

  it("replaces an en-dash with a plain ASCII hyphen so ranges stay readable", () => {
    expect(stripDashes("10\u201320 percent")).toBe("10-20 percent");
  });

  it("leaves ASCII hyphens and model identifiers untouched", () => {
    expect(stripDashes("claude-3-5-sonnet")).toBe("claude-3-5-sonnet");
  });

  it("leaves prose with no long dash untouched", () => {
    expect(stripDashes("no long dash here")).toBe("no long dash here");
  });

  it("recurses through nested objects and arrays, leaving non-strings intact", () => {
    const input = {
      narrative: "cost\u2014driven",
      confidence: 0.8,
      reduced: false,
      items: ["a\u2013b", { note: "x\u2014y" }],
      empty: null,
    };
    expect(deepStripDashes(input)).toEqual({
      narrative: "cost - driven",
      confidence: 0.8,
      reduced: false,
      items: ["a-b", { note: "x - y" }],
      empty: null,
    });
  });
});
