import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertValidKey,
  LocalFsArchiveStore,
} from "./archiveStore";
import { GcsArchiveStore } from "./gcsArchiveStore";

// The archive store boundary, exercised without a database. The local-fs store
// is a real, write-once-capable store on disk; the GCS adapter is "available,
// not connected" until a bucket is set, and its put/get/list work over an
// injected fetch so the REST shape is proven without a network.

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ei-archive-test-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("assertValidKey", () => {
  it("accepts a multi-segment object key", () => {
    expect(() => assertValidKey("ledger/2026-06-15-abc.json")).not.toThrow();
  });

  it("rejects empty, traversal, and illegal segments", () => {
    expect(() => assertValidKey("")).toThrow(/Invalid archive key/);
    expect(() => assertValidKey("ledger//x.json")).toThrow(/Invalid archive key/);
    expect(() => assertValidKey("ledger/../etc/passwd")).toThrow(/Invalid archive key/);
    expect(() => assertValidKey("ledger/.")).toThrow(/Invalid archive key/);
    expect(() => assertValidKey("ledger/has space.json")).toThrow(/Invalid archive key/);
  });
});

describe("LocalFsArchiveStore", () => {
  it("round-trips bytes through put and get", async () => {
    const store = new LocalFsArchiveStore(root);
    const payload = Buffer.from("hello archive", "utf8");
    await store.put("ledger/a.json", payload);
    const got = await store.get("ledger/a.json");
    expect(got).not.toBeNull();
    expect(got!.equals(payload)).toBe(true);
  });

  it("returns null for a missing object", async () => {
    const store = new LocalFsArchiveStore(root);
    expect(await store.get("ledger/missing.json")).toBeNull();
  });

  it("lists keys under a prefix in sorted order, including nested", async () => {
    const store = new LocalFsArchiveStore(root);
    await store.put("list/b.json", Buffer.from("b"));
    await store.put("list/a.json", Buffer.from("a"));
    await store.put("list/nested/c.json", Buffer.from("c"));
    await store.put("other/d.json", Buffer.from("d"));
    const keys = await store.list("list/");
    expect(keys).toEqual(["list/a.json", "list/b.json", "list/nested/c.json"]);
  });

  it("enforces write-once: a second write to the same key fails loudly", async () => {
    const store = new LocalFsArchiveStore(root);
    await store.put("once/x.json", Buffer.from("first"), { writeOnce: true });
    await expect(
      store.put("once/x.json", Buffer.from("second"), { writeOnce: true }),
    ).rejects.toThrow(/already exists \(write-once\)/);
    // The original bytes are intact: the failed write did not clobber them.
    const got = await store.get("once/x.json");
    expect(got!.toString("utf8")).toBe("first");
  });

  it("overwrites when write-once is not requested", async () => {
    const store = new LocalFsArchiveStore(root);
    await store.put("rw/y.json", Buffer.from("first"));
    await store.put("rw/y.json", Buffer.from("second"));
    const got = await store.get("rw/y.json");
    expect(got!.toString("utf8")).toBe("second");
  });

  it("rejects an invalid key on put and get", async () => {
    const store = new LocalFsArchiveStore(root);
    await expect(store.put("../escape.json", Buffer.from("x"))).rejects.toThrow(/Invalid archive key/);
    await expect(store.get("../escape.json")).rejects.toThrow(/Invalid archive key/);
  });

  it("describes itself as the connected local provider", () => {
    const store = new LocalFsArchiveStore(root);
    expect(store.describe()).toEqual({ provider: "local", connected: true });
  });

  it("reports existence honestly", async () => {
    const store = new LocalFsArchiveStore(root);
    await store.put("ex/present.json", Buffer.from("p"));
    expect(await store.exists("ex/present.json")).toBe(true);
    expect(await store.exists("ex/absent.json")).toBe(false);
  });
});

// A minimal fetch stand-in that lets a test assert the request shape and choose
// the response status and body, so the GCS REST behaviour is provable offline.
interface FakeCall {
  url: string;
  init?: RequestInit;
}

function fakeFetch(
  handler: (call: FakeCall) => { status: number; body?: Buffer },
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body } = handler({ url, init });
    const bytes = body ?? Buffer.alloc(0);
    return {
      status,
      async json() {
        return JSON.parse(bytes.length ? bytes.toString("utf8") : "{}");
      },
      async arrayBuffer() {
        return Uint8Array.from(bytes).buffer;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("GcsArchiveStore available-not-connected", () => {
  const savedBucket = process.env.GCS_ARCHIVE_BUCKET;

  beforeAll(() => {
    delete process.env.GCS_ARCHIVE_BUCKET;
  });

  afterAll(() => {
    if (savedBucket === undefined) delete process.env.GCS_ARCHIVE_BUCKET;
    else process.env.GCS_ARCHIVE_BUCKET = savedBucket;
  });

  it("constructs without validating anything (never crashes the boot)", () => {
    expect(() => new GcsArchiveStore()).not.toThrow();
  });

  it("describes itself as the gcs provider, not connected without a bucket", () => {
    expect(new GcsArchiveStore().describe()).toEqual({ provider: "gcs", connected: false });
  });

  it("throws a precise connect error on first use when the bucket is unset", async () => {
    const store = new GcsArchiveStore();
    const expected = /available, not connected: set GCS_ARCHIVE_BUCKET to connect it/;
    await expect(store.put("ledger/x.json", Buffer.from("x"))).rejects.toThrow(expected);
    await expect(store.get("ledger/x.json")).rejects.toThrow(expected);
    await expect(store.list("ledger/")).rejects.toThrow(expected);
  });
});

describe("GcsArchiveStore over an injected fetch", () => {
  it("reports connected once a bucket is configured", () => {
    const store = new GcsArchiveStore({ bucket: "my-bucket" });
    expect(store.describe()).toEqual({ provider: "gcs", connected: true });
  });

  it("PUTs with the write-once precondition and bearer token", async () => {
    let seen: FakeCall | null = null;
    const store = new GcsArchiveStore({
      bucket: "my-bucket",
      tokenSource: "env",
      accessToken: "test-token",
      fetchImpl: fakeFetch((call) => {
        seen = call;
        return { status: 200 };
      }),
    });
    await store.put("ledger/a.json", Buffer.from("payload"), { writeOnce: true });
    expect(seen).not.toBeNull();
    const call = seen as unknown as FakeCall;
    expect(call.url).toContain("uploadType=media");
    expect(call.url).toContain("name=ledger%2Fa.json");
    expect(call.url).toContain("ifGenerationMatch=0");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("maps a 412 precondition failure to a write-once error", async () => {
    const store = new GcsArchiveStore({
      bucket: "my-bucket",
      tokenSource: "env",
      accessToken: "test-token",
      fetchImpl: fakeFetch(() => ({ status: 412 })),
    });
    await expect(
      store.put("ledger/a.json", Buffer.from("x"), { writeOnce: true }),
    ).rejects.toThrow(/already exists \(write-once\)/);
  });

  it("GETs bytes on 200 and null on 404", async () => {
    const found = new GcsArchiveStore({
      bucket: "my-bucket",
      tokenSource: "env",
      accessToken: "test-token",
      fetchImpl: fakeFetch(() => ({ status: 200, body: Buffer.from("the-bytes") })),
    });
    const got = await found.get("ledger/a.json");
    expect(got!.toString("utf8")).toBe("the-bytes");

    const missing = new GcsArchiveStore({
      bucket: "my-bucket",
      tokenSource: "env",
      accessToken: "test-token",
      fetchImpl: fakeFetch(() => ({ status: 404 })),
    });
    expect(await missing.get("ledger/a.json")).toBeNull();
  });

  it("requires an access token when the token source is env", async () => {
    const store = new GcsArchiveStore({
      bucket: "my-bucket",
      tokenSource: "env",
      fetchImpl: fakeFetch(() => ({ status: 200 })),
    });
    await expect(store.put("ledger/a.json", Buffer.from("x"))).rejects.toThrow(
      /GCS_ARCHIVE_ACCESS_TOKEN is not set/,
    );
  });
});
