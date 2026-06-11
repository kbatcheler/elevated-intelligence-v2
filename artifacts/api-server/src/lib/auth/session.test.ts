import { describe, expect, it } from "vitest";
import { SESSION_TTL_SECONDS, signSession, verifySession } from "./session";
import type { SessionPayload } from "./session";

const SECRET = "session-signing-secret";
const payload: SessionPayload = {
  userId: "11111111-1111-1111-1111-111111111111",
  role: "provider-owner",
  iat: Math.floor(new Date("2026-06-11T00:00:00Z").getTime() / 1000),
};

describe("session signing", () => {
  it("round-trips a payload", () => {
    const token = signSession(payload, SECRET);
    expect(verifySession(token, SECRET, new Date("2026-06-11T01:00:00Z"))).toEqual(payload);
  });

  it("rejects a wrong secret", () => {
    const token = signSession(payload, SECRET);
    expect(verifySession(token, "different-secret")).toBeNull();
  });

  it("rejects a tampered payload body", () => {
    const token = signSession(payload, SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, role: "provider-member" }),
      "utf8",
    ).toString("base64url");
    expect(verifySession(forged + "." + sig, SECRET)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signSession(payload, SECRET);
    const [body] = token.split(".");
    expect(verifySession(body + ".not-the-signature", SECRET)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession("no-dot", SECRET)).toBeNull();
    expect(verifySession(".onlysig", SECRET)).toBeNull();
    expect(verifySession("onlybody.", SECRET)).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = signSession(payload, SECRET);
    const past = new Date((payload.iat + SESSION_TTL_SECONDS + 1) * 1000);
    expect(verifySession(token, SECRET, past)).toBeNull();
  });
});
