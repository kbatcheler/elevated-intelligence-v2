import { describe, expect, it } from "vitest";
import { countClaimItems, deltaStyle, safeDownloadName } from "./replayView";

describe("replayView.countClaimItems", () => {
  it("counts only well-formed object items", () => {
    const claims = { items: [{ a: 1 }, { b: 2 }, null, "x", 3, {}] };
    expect(countClaimItems(claims)).toBe(3);
  });

  it("returns zero for null, a missing items field, or a non-array items field", () => {
    expect(countClaimItems(null)).toBe(0);
    expect(countClaimItems({})).toBe(0);
    expect(countClaimItems({ items: "nope" })).toBe(0);
  });
});

describe("replayView.deltaStyle", () => {
  it("prefixes a positive move with + and inks it teal", () => {
    expect(deltaStyle(4)).toEqual({ sign: "+", color: "var(--teal-ink)" });
  });

  it("inks a negative move coral with no added sign", () => {
    expect(deltaStyle(-2)).toEqual({ sign: "", color: "var(--coral-ink)" });
  });

  it("keeps an exact zero neutral", () => {
    expect(deltaStyle(0)).toEqual({ sign: "", color: "var(--slate-light)" });
  });
});

describe("replayView.safeDownloadName", () => {
  it("collapses each run of unsafe characters to a single underscore", () => {
    expect(safeDownloadName("Acme, Inc. / North")).toBe("Acme_Inc._North");
  });

  it("clamps to 80 characters", () => {
    expect(safeDownloadName("a".repeat(200))).toHaveLength(80);
  });

  it("never returns an empty string, falling back to 'tenant' for empty input", () => {
    // An all-unsafe name still yields a single underscore, never empty.
    expect(safeDownloadName("///")).toBe("_");
    // Only genuinely empty output falls through to the constant default.
    expect(safeDownloadName("")).toBe("tenant");
  });
});
