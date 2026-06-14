import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViewerPins, mintViewerPin, revokeViewerPin } from "./clientApi";

type FetchResult = { ok: boolean; status: number; json?: () => Promise<unknown> };

const originalFetch = globalThis.fetch;

function mockFetch(result: FetchResult | Error) {
  const fn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return {
      ok: result.ok,
      status: result.status,
      json: result.json ?? (async () => ({})),
    };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("clientApi.fetchViewerPins", () => {
  it("returns ready with the items when the list is non-empty", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ pins: [{ id: "p1" }] }) });
    expect(await fetchViewerPins()).toEqual({ state: "ready", items: [{ id: "p1" }] });
    expect(fn).toHaveBeenCalledWith("/api/client/viewer-pins");
  });

  it("returns empty when the list is empty", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ pins: [] }) });
    expect(await fetchViewerPins()).toEqual({ state: "empty", items: [] });
  });

  it("treats a missing list field as empty", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({}) });
    expect(await fetchViewerPins()).toEqual({ state: "empty", items: [] });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchViewerPins()).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok, non-401 status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchViewerPins()).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchViewerPins()).toEqual({ state: "error" });
  });
});

describe("clientApi.mintViewerPin", () => {
  it("returns the minted code on success and posts the payload", async () => {
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ pin: { code: "WXYZ" } }) });
    const payload = { label: "Acme viewer", maxUses: 1, expiresInDays: 14 };
    expect(await mintViewerPin(payload)).toEqual({ code: "WXYZ" });
    expect(fn).toHaveBeenCalledWith("/api/client/viewer-pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await mintViewerPin({ label: "", maxUses: 1, expiresInDays: 14 })).toEqual({
      unauthorized: true,
    });
  });

  it("surfaces the server error code on a non-ok body", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "scope_role_forbidden" }) });
    expect(await mintViewerPin({ label: "", maxUses: 1, expiresInDays: 14 })).toEqual({
      error: "scope_role_forbidden",
    });
  });

  it("falls back to a generic error when the body has none", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({}) });
    expect(await mintViewerPin({ label: "", maxUses: 1, expiresInDays: 14 })).toEqual({
      error: "failed",
    });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await mintViewerPin({ label: "", maxUses: 1, expiresInDays: 14 })).toEqual({
      error: "failed",
    });
  });
});

describe("clientApi.revokeViewerPin", () => {
  it("posts to the revoke route and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await revokeViewerPin("p1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/client/viewer-pins/p1/revoke", { method: "POST" });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await revokeViewerPin("p1")).toEqual({ unauthorized: true });
  });

  it("returns an error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await revokeViewerPin("p1")).toEqual({ error: "failed" });
  });

  it("returns an error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await revokeViewerPin("p1")).toEqual({ error: "failed" });
  });
});
