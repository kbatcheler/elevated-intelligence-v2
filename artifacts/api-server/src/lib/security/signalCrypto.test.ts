import { afterAll, describe, expect, it } from "vitest";
import { isEncryptedSignalEnvelope } from "@workspace/db";
import { CryptoShreddedError, SignalEncryptionError } from "./errors";
import { getKmsRuntime } from "./kms";
import { decryptSignalValue, encryptSignalValue } from "./signalCrypto";

// Envelope encryption round trip and its loud failure modes, against the working
// local KMS keyring. Each case provisions its own KEK so the cases never share
// key material; the refs are destroyed afterwards so the keyring is left clean.
const kms = getKmsRuntime();
const refs: string[] = [];

async function freshKeyRef(): Promise<string> {
  const { kmsKeyRef } = await kms.provisionTenantKey("crypto-test-" + Math.random().toString(36).slice(2));
  refs.push(kmsKeyRef);
  return kmsKeyRef;
}

afterAll(async () => {
  for (const ref of refs) await kms.destroyKey(ref);
});

describe("encryptSignalValue / decryptSignalValue", () => {
  it("round-trips a scalar and a numeric vector through an envelope", async () => {
    const keyRef = await freshKeyRef();

    const scalar = await encryptSignalValue(0.42, keyRef);
    expect(isEncryptedSignalEnvelope(scalar)).toBe(true);
    expect(scalar.keyRef).toBe(keyRef);
    expect(await decryptSignalValue(scalar, keyRef)).toBe(0.42);

    const vector = await encryptSignalValue([3, 5, 2], keyRef);
    expect(isEncryptedSignalEnvelope(vector)).toBe(true);
    expect(await decryptSignalValue(vector, keyRef)).toEqual([3, 5, 2]);
  });

  it("stores no plaintext: the ciphertext does not contain the value", async () => {
    const keyRef = await freshKeyRef();
    const env = await encryptSignalValue(1234.5, keyRef);
    expect(env.ct).not.toContain("1234");
    expect(JSON.stringify(env)).not.toContain("1234.5");
  });

  it("fails loud on a legacy plaintext value (not an envelope)", async () => {
    await expect(decryptSignalValue(42, "kek:none")).rejects.toBeInstanceOf(SignalEncryptionError);
    await expect(decryptSignalValue([1, 2, 3], "kek:none")).rejects.toBeInstanceOf(
      SignalEncryptionError,
    );
  });

  it("fails loud after the KEK is destroyed (crypto-shred)", async () => {
    const { kmsKeyRef } = await kms.provisionTenantKey("crypto-shred-" + Math.random().toString(36).slice(2));
    const env = await encryptSignalValue(7, kmsKeyRef);
    await kms.destroyKey(kmsKeyRef);
    await expect(decryptSignalValue(env, kmsKeyRef)).rejects.toBeInstanceOf(CryptoShreddedError);
  });

  it("fails GCM authentication when a ciphertext byte is flipped (tamper)", async () => {
    const keyRef = await freshKeyRef();
    const env = await encryptSignalValue(99, keyRef);
    const raw = Buffer.from(env.ct, "base64");
    raw[0] = raw[0] ^ 0xff;
    const tampered = { ...env, ct: raw.toString("base64") };
    await expect(decryptSignalValue(tampered, keyRef)).rejects.toBeInstanceOf(SignalEncryptionError);
  });

  it("refuses an envelope whose keyRef is not the tenant's active key", async () => {
    const keyRef = await freshKeyRef();
    const env = await encryptSignalValue(2.5, keyRef);
    // The stored envelope is sealed under keyRef, but the caller's active key is a
    // different reference. The guard rejects it before any unwrap is attempted, so
    // a stale or cross-tenant envelope is never opened on its own embedded keyRef.
    await expect(
      decryptSignalValue(env, "kek:some-other-active-key"),
    ).rejects.toBeInstanceOf(SignalEncryptionError);
  });

  it("cannot be opened under a different tenant key", async () => {
    const keyRef = await freshKeyRef();
    const otherRef = await freshKeyRef();
    const env = await encryptSignalValue(3.14, keyRef);
    // Re-point the envelope at a different, valid KEK and open it AS that key, so
    // the keyRef guard passes. The wrapped DEK was sealed under the first KEK, so
    // unwrapping under the second fails authentication: no cross-tenant read.
    const crossed = { ...env, keyRef: otherRef };
    await expect(decryptSignalValue(crossed, otherRef)).rejects.toBeInstanceOf(
      CryptoShreddedError,
    );
  });
});
