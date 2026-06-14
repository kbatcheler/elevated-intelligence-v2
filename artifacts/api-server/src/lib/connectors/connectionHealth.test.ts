import { describe, expect, it } from "vitest";
import { deriveConnectionHealth } from "./connectionHealth";

const HOUR = 3600 * 1000;
const now = new Date("2026-06-14T12:00:00.000Z");
const stalenessThresholdSeconds = 24 * 3600; // one day

describe("deriveConnectionHealth", () => {
  it("is error when the stored status is error", () => {
    expect(
      deriveConnectionHealth({
        status: "error",
        lastSuccessAt: new Date(now.getTime() - HOUR),
        lastErrorAt: null,
        stalenessThresholdSeconds,
        now,
      }),
    ).toBe("error");
  });

  it("is degraded when it has never succeeded", () => {
    expect(
      deriveConnectionHealth({
        status: "connected",
        lastSuccessAt: null,
        lastErrorAt: null,
        stalenessThresholdSeconds,
        now,
      }),
    ).toBe("degraded");
  });

  it("is healthy with a recent success and no newer error", () => {
    expect(
      deriveConnectionHealth({
        status: "connected",
        lastSuccessAt: new Date(now.getTime() - HOUR),
        lastErrorAt: null,
        stalenessThresholdSeconds,
        now,
      }),
    ).toBe("healthy");
  });

  it("is degraded when the last success is older than the staleness threshold", () => {
    expect(
      deriveConnectionHealth({
        status: "connected",
        lastSuccessAt: new Date(now.getTime() - 25 * HOUR),
        lastErrorAt: null,
        stalenessThresholdSeconds,
        now,
      }),
    ).toBe("degraded");
  });

  it("is degraded when an error is more recent than the last success", () => {
    expect(
      deriveConnectionHealth({
        status: "connected",
        lastSuccessAt: new Date(now.getTime() - 2 * HOUR),
        lastErrorAt: new Date(now.getTime() - HOUR),
        stalenessThresholdSeconds,
        now,
      }),
    ).toBe("degraded");
  });

  it("stays healthy when the last error predates the last success", () => {
    expect(
      deriveConnectionHealth({
        status: "connected",
        lastSuccessAt: new Date(now.getTime() - HOUR),
        lastErrorAt: new Date(now.getTime() - 2 * HOUR),
        stalenessThresholdSeconds,
        now,
      }),
    ).toBe("healthy");
  });
});
