import { describe, expect, it } from "vitest";
import {
  basisLabel,
  basisPillClass,
  formatBrier,
  formatRatioPct,
  pct,
} from "./format";

describe("format.formatRatioPct", () => {
  it("renders a 0..1 ratio as a whole-number percent", () => {
    expect(formatRatioPct(0.726)).toBe("73%");
    expect(formatRatioPct(0)).toBe("0%");
    expect(formatRatioPct(1)).toBe("100%");
  });

  it("renders a plain dash for a missing or non-finite ratio, never a fabricated zero", () => {
    expect(formatRatioPct(null)).toBe("-");
    expect(formatRatioPct(Number.NaN)).toBe("-");
    expect(formatRatioPct(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("format.formatBrier", () => {
  it("renders three decimals for a real score", () => {
    expect(formatBrier(0.2)).toBe("0.200");
    expect(formatBrier(0)).toBe("0.000");
  });

  it("renders a plain dash when there is no score", () => {
    expect(formatBrier(null)).toBe("-");
    expect(formatBrier(Number.NaN)).toBe("-");
  });
});

describe("format.pct", () => {
  it("rounds to a whole-number percent", () => {
    expect(pct(50.4)).toBe("50%");
    expect(pct(50.6)).toBe("51%");
  });
});

describe("format basis helpers", () => {
  it("maps the verified and modelled bases to their pill class and label", () => {
    expect(basisPillClass("verified")).toBe("pill-verified");
    expect(basisPillClass("modelled")).toBe("pill-modelled");
    expect(basisLabel("verified")).toBe("Verified");
    expect(basisLabel("modelled")).toBe("Modelled");
  });
});
