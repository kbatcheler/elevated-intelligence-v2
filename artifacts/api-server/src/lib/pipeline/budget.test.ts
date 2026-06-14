import { describe, expect, it } from "vitest";
import { budgetCaps, monthStart } from "./budget";

// Pure-function coverage for the budget governor: env parsing and the month
// window. The spend-summing and the throw-on-cap behaviour are exercised against
// a real Postgres in spend.integration.test.ts.

describe("budgetCaps", () => {
  it("uses the documented defaults when the environment is empty", () => {
    expect(budgetCaps({})).toEqual({
      globalMonthlyCapUsd: 1000,
      tenantMonthlyCapUsd: 50,
      alertThreshold: 0.8,
    });
  });

  it("reads numeric overrides from the environment", () => {
    expect(
      budgetCaps({
        SPEND_GLOBAL_MONTHLY_CAP_USD: "250",
        SPEND_TENANT_MONTHLY_CAP_USD: "10",
        SPEND_ALERT_THRESHOLD: "0.5",
      }),
    ).toEqual({ globalMonthlyCapUsd: 250, tenantMonthlyCapUsd: 10, alertThreshold: 0.5 });
  });

  it("falls back to the default on a non-numeric or negative value", () => {
    expect(budgetCaps({ SPEND_GLOBAL_MONTHLY_CAP_USD: "nope" }).globalMonthlyCapUsd).toBe(1000);
    expect(budgetCaps({ SPEND_TENANT_MONTHLY_CAP_USD: "-5" }).tenantMonthlyCapUsd).toBe(50);
  });

  it("allows a zero cap (cap disabled) and clamps the threshold to a fraction", () => {
    expect(budgetCaps({ SPEND_GLOBAL_MONTHLY_CAP_USD: "0" }).globalMonthlyCapUsd).toBe(0);
    expect(budgetCaps({ SPEND_ALERT_THRESHOLD: "2" }).alertThreshold).toBe(1);
    expect(budgetCaps({ SPEND_ALERT_THRESHOLD: "0" }).alertThreshold).toBe(0.8);
  });
});

describe("monthStart", () => {
  it("returns the first instant of the current UTC month", () => {
    const d = monthStart(new Date(Date.UTC(2026, 5, 14, 9, 30, 0)));
    expect(d.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
