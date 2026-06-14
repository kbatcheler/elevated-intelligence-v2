import { afterEach, describe, expect, it } from "vitest";
import { GcpSecretManagerSecretStore } from "./gcpSecretStore";
import { EnvSecretStore, getSecretStore, requireSecret, setSecretStore } from "./secretStore";

const REF = "EI_TEST_SECRET_REF";

// Env keys the provider-selection and GCP adapter read. Snapshot and restore so
// a test never leaks configuration into the next one.
const ENV_KEYS = [
  "SECRET_STORE_PROVIDER",
  "GCP_PROJECT_ID",
  "GCP_SECRET_MANAGER_ACCESS_TOKEN",
  "GCP_SECRET_MANAGER_TOKEN_SOURCE",
  "GCP_SECRET_MANAGER_ENDPOINT",
  "GCP_SECRET_MANAGER_TIMEOUT_MS",
];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  delete process.env[REF];
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setSecretStore(null);
});

describe("EnvSecretStore", () => {
  it("returns null for a missing secret rather than undefined", async () => {
    const store = new EnvSecretStore();
    expect(await store.get(REF)).toBeNull();
  });

  it("round-trips set then get", async () => {
    const store = new EnvSecretStore();
    await store.set(REF, "value-123");
    expect(await store.get(REF)).toBe("value-123");
  });

  it("delete removes the secret", async () => {
    const store = new EnvSecretStore();
    await store.set(REF, "value-123");
    await store.delete(REF);
    expect(await store.get(REF)).toBeNull();
  });
});

describe("requireSecret", () => {
  it("returns the value when present", async () => {
    const store = new EnvSecretStore();
    await store.set(REF, "present");
    expect(await requireSecret(REF, store)).toBe("present");
  });

  it("throws a clear error when missing", async () => {
    const store = new EnvSecretStore();
    await expect(requireSecret(REF, store)).rejects.toThrow(/not configured/i);
  });

  it("throws when the value is an empty string", async () => {
    const store = new EnvSecretStore();
    await store.set(REF, "");
    await expect(requireSecret(REF, store)).rejects.toThrow(/not configured/i);
  });
});

describe("getSecretStore provider selection", () => {
  it("defaults to the env-backed store when no provider is set", () => {
    delete process.env.SECRET_STORE_PROVIDER;
    setSecretStore(null);
    expect(getSecretStore()).toBeInstanceOf(EnvSecretStore);
  });

  it("selects the GCP adapter when SECRET_STORE_PROVIDER=gcp, without crashing the boot when unconfigured", () => {
    process.env.SECRET_STORE_PROVIDER = "gcp";
    delete process.env.GCP_PROJECT_ID;
    setSecretStore(null);
    // Construction must not throw even with no project: it is available, not
    // connected, and only surfaces on first use.
    expect(getSecretStore()).toBeInstanceOf(GcpSecretManagerSecretStore);
  });
});

// A recording fetch double. It returns canned responses by URL and captures
// every call so a test can assert the exact REST shape, headers, and bodies.
interface RecordedCall {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}
function recorder(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const { status, body } = handler(url, init);
    return {
      status,
      ok: status >= 200 && status < 300,
      async json() {
        return body;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("GcpSecretManagerSecretStore (env token source)", () => {
  it("resolves a secret, decoding the base64 access payload", async () => {
    const { calls, fetchImpl } = recorder((url) => {
      if (url.endsWith("/versions/latest:access")) {
        return { status: 200, body: { payload: { data: b64("warehouse://creds") } } };
      }
      return { status: 500 };
    });
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    expect(await store.get("WAREHOUSE_REF")).toBe("warehouse://creds");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/v1/projects/proj/secrets/WAREHOUSE_REF/versions/latest:access");
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
  });

  it("returns null when the secret does not exist (404)", async () => {
    const { fetchImpl } = recorder(() => ({ status: 404 }));
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    expect(await store.get("MISSING_REF")).toBeNull();
  });

  it("throws on an unexpected status without leaking the response body", async () => {
    const { fetchImpl } = recorder(() => ({ status: 500, body: { error: "leaked-secret-body" } }));
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    await expect(store.get("REF")).rejects.toThrow(/access failed with http 500/);
    await expect(store.get("REF")).rejects.not.toThrow(/leaked-secret-body/);
  });

  it("creates the secret then adds a base64 version on set", async () => {
    const { calls, fetchImpl } = recorder((url) => {
      if (url.includes("?secretId=")) return { status: 200 };
      if (url.endsWith(":addVersion")) return { status: 200 };
      return { status: 500 };
    });
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    await store.set("REF", "the-value");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/v1/projects/proj/secrets?secretId=REF");
    const addCall = calls.find((c) => c.url.endsWith(":addVersion"))!;
    const payload = JSON.parse(addCall.body!) as { payload: { data: string } };
    expect(Buffer.from(payload.payload.data, "base64").toString("utf8")).toBe("the-value");
  });

  it("tolerates an already-existing secret (409) on set", async () => {
    const { calls, fetchImpl } = recorder((url) => {
      if (url.includes("?secretId=")) return { status: 409 };
      if (url.endsWith(":addVersion")) return { status: 200 };
      return { status: 500 };
    });
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    await expect(store.set("REF", "v")).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it("deletes the secret resource and treats a 404 as already gone", async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 404 }));
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    await expect(store.delete("REF")).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toContain("/v1/projects/proj/secrets/REF");
  });

  it("rejects a ref that is not a valid secret id before any network call", async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 200 }));
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    await expect(store.get("bad/ref")).rejects.toThrow(/Invalid secret reference/);
    expect(calls).toHaveLength(0);
  });

  it("is available, not connected until a project is configured", async () => {
    delete process.env.GCP_PROJECT_ID;
    const { calls, fetchImpl } = recorder(() => ({ status: 200 }));
    // Construction does not throw.
    const store = new GcpSecretManagerSecretStore({
      tokenSource: "env",
      accessToken: "tok",
      fetchImpl,
    });
    await expect(store.get("REF")).rejects.toThrow(/available, not connected/);
    expect(calls).toHaveLength(0);
  });

  it("throws when the env token source is selected but no token is set", async () => {
    delete process.env.GCP_SECRET_MANAGER_ACCESS_TOKEN;
    const { fetchImpl } = recorder(() => ({ status: 200 }));
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "env",
      fetchImpl,
    });
    await expect(store.get("REF")).rejects.toThrow(/GCP_SECRET_MANAGER_ACCESS_TOKEN/);
  });
});

describe("GcpSecretManagerSecretStore (metadata token source)", () => {
  it("fetches a metadata-server token, then uses it to access the secret", async () => {
    const { calls, fetchImpl } = recorder((url) => {
      if (url.includes("metadata.test")) {
        return { status: 200, body: { access_token: "meta-tok", expires_in: 3600 } };
      }
      if (url.endsWith("/versions/latest:access")) {
        return { status: 200, body: { payload: { data: b64("v") } } };
      }
      return { status: 500 };
    });
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "metadata",
      metadataUrl: "http://metadata.test/token",
      fetchImpl,
    });
    expect(await store.get("REF")).toBe("v");
    expect(calls[0]!.url).toBe("http://metadata.test/token");
    expect(calls[0]!.headers["Metadata-Flavor"]).toBe("Google");
    expect(calls[1]!.headers.Authorization).toBe("Bearer meta-tok");
  });

  it("throws on a transport failure rather than fabricating a value", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const store = new GcpSecretManagerSecretStore({
      projectId: "proj",
      tokenSource: "metadata",
      metadataUrl: "http://metadata.test/token",
      fetchImpl,
    });
    await expect(store.get("REF")).rejects.toThrow(/ECONNREFUSED/);
  });
});
