import { describe, expect, it } from "vitest";
import { hashRateLimitKey } from "./keyHash";

describe("hashRateLimitKey", () => {
  const secret = "test-session-secret";

  it("is deterministic for the same key and secret, so it can be an upsert key", () => {
    const k = "login:203.0.113.7:alice@example.com";
    expect(hashRateLimitKey(k, secret)).toBe(hashRateLimitKey(k, secret));
  });

  it("separates digests by the secret, so a rotation resets the windows", () => {
    const k = "login:203.0.113.7:alice@example.com";
    expect(hashRateLimitKey(k, secret)).not.toBe(hashRateLimitKey(k, "other-secret"));
  });

  it("never embeds the raw caller identifier (no email or IP in the digest)", () => {
    const email = "alice@example.com";
    const ip = "203.0.113.7";
    const digest = hashRateLimitKey(`login:${ip}:${email}`, secret);
    expect(digest).not.toContain(email);
    expect(digest).not.toContain(ip);
    expect(digest).not.toContain("@");
  });

  it("maps different callers to different digests", () => {
    expect(hashRateLimitKey("login:203.0.113.7:alice@example.com", secret)).not.toBe(
      hashRateLimitKey("login:203.0.113.8:bob@example.com", secret),
    );
  });
});
