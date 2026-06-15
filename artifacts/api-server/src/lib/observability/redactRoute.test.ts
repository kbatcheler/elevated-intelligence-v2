import { describe, it, expect } from "vitest";
import { redactRoute } from "./redactRoute";

describe("redactRoute", () => {
  it("redacts the public diagnosis share token to the route template", () => {
    const token = "abc123_TOKEN-secretValue";
    expect(redactRoute(`/api/public/diagnosis/${token}`)).toBe("/api/public/diagnosis/:token");
  });

  it("never leaves the token substring in the redacted route", () => {
    const token = "ZmFrZS1zZWNyZXQtdG9rZW4tdmFsdWU";
    const out = redactRoute(`/api/public/diagnosis/${token}`);
    expect(out.includes(token)).toBe(false);
  });

  it("leaves the diagnosis collection path (no token segment) unchanged", () => {
    expect(redactRoute("/api/public/diagnosis")).toBe("/api/public/diagnosis");
  });

  it("leaves non-secret routes unchanged", () => {
    expect(redactRoute("/api/tenants/abc/share-tokens")).toBe("/api/tenants/abc/share-tokens");
    expect(redactRoute("/api/tenants/abc/share-tokens/t1/revoke")).toBe(
      "/api/tenants/abc/share-tokens/t1/revoke",
    );
    expect(redactRoute("/api/overview")).toBe("/api/overview");
    expect(redactRoute("/")).toBe("/");
  });
});
