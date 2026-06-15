import { describe, expect, it } from "vitest";
import { parsePredictedValueUsd } from "./predictedValue";

describe("parsePredictedValueUsd", () => {
  it("parses a dollar figure with a millions suffix", () => {
    expect(parsePredictedValueUsd("Recovers an estimated $2.4M within two quarters")).toBe(2_400_000);
  });

  it("parses thousands, millions, and billions suffixes case-insensitively", () => {
    expect(parsePredictedValueUsd("$500K of working capital")).toBe(500_000);
    expect(parsePredictedValueUsd("save $1.2 million annually")).toBe(1_200_000);
    expect(parsePredictedValueUsd("$3BN total addressable")).toBe(3_000_000_000);
    expect(parsePredictedValueUsd("$2.5bn")).toBe(2_500_000_000);
  });

  it("parses a plain amount with thousands separators and no unit", () => {
    expect(parsePredictedValueUsd("$1,200,000 one-time")).toBe(1_200_000);
    expect(parsePredictedValueUsd("$750 per seat")).toBe(750);
  });

  it("accepts a USD token instead of a dollar sign", () => {
    expect(parsePredictedValueUsd("USD 2.4M recovery")).toBe(2_400_000);
    expect(parsePredictedValueUsd("usd2.4m")).toBe(2_400_000);
  });

  it("returns null for a percentage or a non-dollar metric", () => {
    expect(parsePredictedValueUsd("12% reduction in churn")).toBeNull();
    expect(parsePredictedValueUsd("Recovers 2.1 points of gross margin")).toBeNull();
    expect(parsePredictedValueUsd("Cuts cycle time by 3 days")).toBeNull();
  });

  it("returns null for empty, missing, or amount-free strings", () => {
    expect(parsePredictedValueUsd(null)).toBeNull();
    expect(parsePredictedValueUsd(undefined)).toBeNull();
    expect(parsePredictedValueUsd("")).toBeNull();
    expect(parsePredictedValueUsd("a strong qualitative lift")).toBeNull();
    expect(parsePredictedValueUsd("$")).toBeNull();
  });

  it("takes the first dollar figure when several appear", () => {
    expect(parsePredictedValueUsd("between $2.4M and $3.1M depending on uptake")).toBe(2_400_000);
  });
});
