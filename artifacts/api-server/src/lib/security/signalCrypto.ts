import { randomBytes } from "node:crypto";
import { isEncryptedSignalEnvelope, type EncryptedSignalEnvelope } from "@workspace/db";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesgcm";
import { SignalEncryptionError } from "./errors";
import { getKmsRuntime, type KmsRuntime } from "./kms";

// Envelope encryption for one derived signal value. A fresh data encryption key
// (DEK) is generated per value, the math is sealed under it with AES-256-GCM,
// and the DEK is wrapped by the tenant KEK behind the KMS seam. Only the
// envelope is stored; the plaintext math never reaches the data store.
const DEK_BYTES = 32;

export async function encryptSignalValue(
  value: number | number[],
  kmsKeyRef: string,
  kms: KmsRuntime = getKmsRuntime(),
): Promise<EncryptedSignalEnvelope> {
  const dek = randomBytes(DEK_BYTES);
  const wrappedDek = await kms.wrapDek(kmsKeyRef, dek);
  const sealed = aesGcmEncrypt(dek, Buffer.from(JSON.stringify(value), "utf8"));
  return {
    v: 1,
    alg: "AES-256-GCM",
    keyRef: kmsKeyRef,
    wrappedDek,
    iv: sealed.iv.toString("base64"),
    tag: sealed.tag.toString("base64"),
    ct: sealed.ct.toString("base64"),
  };
}

// Open an envelope back to the plaintext math. Throws CryptoShreddedError (from
// the KMS) when the tenant key was revoked and destroyed, and SignalEncryptionError
// when the stored value is not an envelope (a legacy plaintext row) or is corrupt.
// It never returns an empty or default value: an unreadable signal is a loud
// failure, not a silent gap in the grounding.
//
// expectedKeyRef is the tenant's current active key reference. The envelope's own
// keyRef is never trusted on its own: it must equal the active key, so a stored row
// sealed under a different or stale key (or a cross-tenant envelope) is refused
// before any unwrap, rather than being opened on the strength of its own embedded
// reference.
export async function decryptSignalValue(
  stored: unknown,
  expectedKeyRef: string,
  kms: KmsRuntime = getKmsRuntime(),
): Promise<number | number[]> {
  if (!isEncryptedSignalEnvelope(stored)) {
    throw new SignalEncryptionError(
      "stored signal is not an encryption envelope: a legacy unencrypted signal requires a refresh to re-derive it under the tenant key",
    );
  }
  if (stored.keyRef !== expectedKeyRef) {
    throw new SignalEncryptionError(
      "stored signal key reference does not match the tenant's active key: refusing to open an envelope sealed under a different key",
    );
  }
  const dek = await kms.unwrapDek(stored.keyRef, stored.wrappedDek);
  let plaintext: Buffer;
  try {
    plaintext = aesGcmDecrypt(dek, {
      iv: Buffer.from(stored.iv, "base64"),
      tag: Buffer.from(stored.tag, "base64"),
      ct: Buffer.from(stored.ct, "base64"),
    });
  } catch {
    throw new SignalEncryptionError("derived signal failed authentication on decrypt");
  }
  const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
  if (typeof parsed === "number" && Number.isFinite(parsed)) {
    return parsed;
  }
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return parsed as number[];
  }
  throw new SignalEncryptionError("decrypted signal value is not the finite numeric math it must be");
}
