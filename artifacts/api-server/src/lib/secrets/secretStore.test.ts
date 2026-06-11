import { afterEach, describe, expect, it } from "vitest";
import { EnvSecretStore, requireSecret } from "./secretStore";

const REF = "EI_TEST_SECRET_REF";

afterEach(() => {
  delete process.env[REF];
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
