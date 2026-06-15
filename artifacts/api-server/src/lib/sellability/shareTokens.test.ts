import { describe, expect, it } from "vitest";
import { clampExpiresInDays, hashShareToken, shareTokenStatus } from "./shareTokens";

describe("hashShareToken", () => {
  it("is a stable sha256 hex digest, never the plaintext", () => {
    const h = hashShareToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("abc");
    expect(hashShareToken("abc")).toBe(h);
    expect(hashShareToken("abd")).not.toBe(h);
  });
});

describe("clampExpiresInDays", () => {
  it("defaults an absent or non-finite value", () => {
    expect(clampExpiresInDays(undefined)).toBe(30);
    expect(clampExpiresInDays(null)).toBe(30);
    expect(clampExpiresInDays(Number.NaN)).toBe(30);
  });
  it("clamps into the supported band and floors fractions", () => {
    expect(clampExpiresInDays(0)).toBe(1);
    expect(clampExpiresInDays(-5)).toBe(1);
    expect(clampExpiresInDays(1000)).toBe(365);
    expect(clampExpiresInDays(7.9)).toBe(7);
  });
});

describe("shareTokenStatus", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  it("reads revoked first, then expired, then active", () => {
    expect(
      shareTokenStatus(
        { revokedAt: new Date("2026-06-10T00:00:00Z"), expiresAt: new Date("2026-12-01T00:00:00Z") },
        now,
      ),
    ).toBe("revoked");
    expect(
      shareTokenStatus({ revokedAt: null, expiresAt: new Date("2026-06-01T00:00:00Z") }, now),
    ).toBe("expired");
    expect(
      shareTokenStatus({ revokedAt: null, expiresAt: new Date("2026-12-01T00:00:00Z") }, now),
    ).toBe("active");
  });
});
