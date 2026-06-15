// SSRF defence tests. The homepage URL is arbitrary user input, so the address
// classifier and the local-alias gate are the load-bearing security boundary.
// These tests are pure (no network): isPrivateAddress is offline, and the
// alias rejections in isHostnameSafe short-circuit before any DNS lookup.

import { describe, expect, it } from "vitest";
import {
  cleanHomepageTarget,
  isHostnameSafe,
  isPrivateAddress,
  sovereignNoFetchHomepageContext,
} from "./homepageContext";

describe("isPrivateAddress", () => {
  it("flags loopback, private, and link-local v4 ranges", () => {
    for (const addr of [
      "0.0.0.0",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
    ]) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
  });

  it("allows real public v4 addresses", () => {
    for (const addr of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isPrivateAddress(addr), addr).toBe(false);
    }
  });

  it("flags loopback and ULA v6 ranges, including v4-mapped", () => {
    for (const addr of ["::1", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
  });

  it("allows a public v6 address", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("treats a malformed v4 address as unsafe", () => {
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
  });
});

describe("isHostnameSafe", () => {
  it("rejects local aliases without a DNS lookup", async () => {
    for (const host of ["localhost", "app.localhost", "printer.local", "metadata"]) {
      const r = await isHostnameSafe(host);
      expect(r.ok, host).toBe(false);
    }
  });

  it("rejects a hostname that does not resolve", async () => {
    const r = await isHostnameSafe("this-domain-should-not-resolve.invalid");
    expect(r.ok).toBe(false);
  });
});

describe("cleanHomepageTarget", () => {
  it("strips protocol, path, and www to a bare domain and canonical https URL", () => {
    expect(cleanHomepageTarget("https://www.Example.com/pricing?x=1")).toEqual({
      domain: "example.com",
      tryUrl: "https://www.Example.com/pricing?x=1",
    });
  });

  it("prepends https for a bare domain", () => {
    expect(cleanHomepageTarget("Example.com")).toEqual({
      domain: "example.com",
      tryUrl: "https://example.com",
    });
  });
});

describe("sovereignNoFetchHomepageContext", () => {
  it("returns an honest declined context with no network IO and zero bytes", () => {
    const ctx = sovereignNoFetchHomepageContext("https://www.example.com/about");
    expect(ctx.ok).toBe(false);
    expect(ctx.domain).toBe("example.com");
    expect(ctx.finalUrl).toBe("https://www.example.com/about");
    expect(ctx.status).toBe(0);
    expect(ctx.bytesFetched).toBe(0);
    expect(ctx.bytesExtracted).toBe(0);
    expect(ctx.durationMs).toBe(0);
    expect(ctx.snippet).toBe("");
    expect(ctx.errorReason).toBe("sovereign mode: public web fetch disabled");
  });

  it("never claims grounding: ok is false so the profile records itself ungrounded", () => {
    expect(sovereignNoFetchHomepageContext("acme.test").ok).toBe(false);
  });
});
