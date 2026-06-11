import { describe, expect, it } from "vitest";
import {
  assertDerivedSignalSet,
  derivedSignalSetSchema,
  isDerivedSignalSet,
} from "./derivedSignalSet";

const tenantId = "550e8400-e29b-41d4-a716-446655440000";

const validSet = {
  source: "quickbooks",
  tenantId,
  generatedAt: "2026-06-11T00:00:00.000Z",
  windowStart: "2026-05-12",
  windowEnd: "2026-06-11",
  signals: [
    { key: "gross_margin_pct", kind: "ratio", value: 0.62, unit: "ratio", window: "30d" },
    { key: "open_invoice_count", kind: "count", value: 142 },
    { key: "dso_trend_delta", kind: "trend_delta", value: -3.4 },
    { key: "aging_distribution", kind: "distribution", value: [0.5, 0.25, 0.15, 0.1] },
    { key: "customer_embedding", kind: "embedding", value: [0.01, -0.22, 0.4, 0.13] },
  ],
};

describe("DerivedSignalSet guard", () => {
  it("accepts a set carrying only derived numeric signals", () => {
    expect(isDerivedSignalSet(validSet)).toBe(true);
    const parsed = assertDerivedSignalSet(validSet);
    expect(parsed.signals).toHaveLength(5);
    expect(parsed.source).toBe("quickbooks");
  });

  it("rejects a signal whose value is free text (a raw record)", () => {
    const withRawText = {
      ...validSet,
      signals: [{ key: "customer_name", kind: "score", value: "Jane Doe" }],
    };
    expect(isDerivedSignalSet(withRawText)).toBe(false);
    expect(() => assertDerivedSignalSet(withRawText)).toThrow(/derive-and-discard/i);
  });

  it("rejects an unexpected key that could smuggle raw rows", () => {
    const withRawRows = {
      ...validSet,
      signals: [
        {
          key: "leaky",
          kind: "score",
          value: 1,
          rawRows: [{ email: "a@b.com", ssn: "000-00-0000" }],
        },
      ],
    };
    expect(isDerivedSignalSet(withRawRows)).toBe(false);
  });

  it("rejects an unexpected top-level key", () => {
    const withExtra = { ...validSet, customerEmails: ["a@b.com"] };
    expect(isDerivedSignalSet(withExtra)).toBe(false);
  });

  it("rejects a vector kind that carries a scalar value", () => {
    const mismatched = {
      ...validSet,
      signals: [{ key: "dist", kind: "distribution", value: 0.5 }],
    };
    expect(isDerivedSignalSet(mismatched)).toBe(false);
  });

  it("rejects a scalar kind that carries an array value", () => {
    const mismatched = {
      ...validSet,
      signals: [{ key: "score", kind: "score", value: [1, 2, 3] }],
    };
    expect(isDerivedSignalSet(mismatched)).toBe(false);
  });

  it("rejects a non-finite numeric value", () => {
    const result = derivedSignalSetSchema.safeParse({
      ...validSet,
      signals: [{ key: "bad", kind: "score", value: Number.POSITIVE_INFINITY }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed tenant id", () => {
    expect(isDerivedSignalSet({ ...validSet, tenantId: "not-a-uuid" })).toBe(false);
  });
});
