import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchIngestionKeys,
  mintIngestionKey,
  uploadFile,
} from "./ingestionApi";

type FetchResult = { ok: boolean; status: number; json?: () => Promise<unknown> };

const originalFetch = globalThis.fetch;

function mockFetch(result: FetchResult | Error) {
  const fn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { ok: result.ok, status: result.status, json: result.json ?? (async () => ({})) };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ingestionApi.fetchIngestionKeys", () => {
  it("returns ready with the keys when the list is non-empty", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ keys: [{ id: "k1" }] }) });
    const out = await fetchIngestionKeys("t1");
    expect(out).toEqual({ state: "ready", items: [{ id: "k1" }] });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/ingestion-keys");
  });

  it("distinguishes an empty list from an error", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ keys: [] }) });
    expect(await fetchIngestionKeys("t1")).toEqual({ state: "empty", items: [] });
  });

  it("returns unauthorized on 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchIngestionKeys("t1")).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok, non-auth status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchIngestionKeys("t1")).toEqual({ state: "error" });
  });
});

describe("ingestionApi.mintIngestionKey", () => {
  it("returns the one-shot minted credential on success", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ keyId: "k1", label: "CI", token: "raw-secret-once" }),
    });
    expect(await mintIngestionKey("t1", "CI")).toEqual({
      minted: { keyId: "k1", label: "CI", token: "raw-secret-once" },
    });
  });

  it("surfaces the server error code on a non-ok response", async () => {
    mockFetch({ ok: false, status: 409, json: async () => ({ error: "label_taken" }) });
    expect(await mintIngestionKey("t1", "CI")).toEqual({ error: "label_taken" });
  });

  it("returns unauthorized on 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await mintIngestionKey("t1", "CI")).toEqual({ unauthorized: true });
  });
});

describe("ingestionApi.uploadFile", () => {
  const file = { name: "data.csv", type: "text/csv" } as unknown as File;

  it("returns the derived-vs-discarded report on success and encodes the query", async () => {
    const report = { accepted: true, signalsCount: 3 };
    const fn = mockFetch({ ok: true, status: 200, json: async () => report });
    expect(await uploadFile("t1", "demand", file)).toEqual({ report });
    expect(fn).toHaveBeenCalledWith(
      "/api/tenants/t1/uploads?layer=demand&filename=data.csv",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces the server error code on a rejected upload", async () => {
    mockFetch({ ok: false, status: 413, json: async () => ({ error: "file_too_large" }) });
    expect(await uploadFile("t1", "demand", file)).toEqual({ error: "file_too_large" });
  });

  it("returns unauthorized on 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await uploadFile("t1", "demand", file)).toEqual({ unauthorized: true });
  });
});
