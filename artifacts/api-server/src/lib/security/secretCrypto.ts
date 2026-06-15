import { randomBytes } from "node:crypto";
import { isEncryptedSignalEnvelope, type EncryptedSignalEnvelope } from "@workspace/db";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesgcm";
import { SignalEncryptionError } from "./errors";
import { getKmsRuntime, type KmsRuntime } from "./kms";

// Envelope encryption for a short secret STRING, reusing the exact envelope
// shape and KMS seam as the derived signal values (signalCrypto.ts). A webhook
// signing secret must be recoverable to recompute its HMAC, so unlike a
// credential it cannot be one-way hashed; it is sealed under the tenant key
// instead. The store holds the wrapped data key and a key reference, never the
// key material, so a leak yields only ciphertext and revoking the tenant key
// crypto-shreds the secret. This differs from encryptSignalValue only in
// carrying a utf8 string rather than the numeric math.
const DEK_BYTES = 32;
const MAX_SECRET_BYTES = 4096;

export async function encryptSecretString(
  value: string,
  kmsKeyRef: string,
  kms: KmsRuntime = getKmsRuntime(),
): Promise<EncryptedSignalEnvelope> {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length === 0 || bytes.length > MAX_SECRET_BYTES) {
    throw new SignalEncryptionError("secret string is empty or too large to seal");
  }
  const dek = randomBytes(DEK_BYTES);
  const wrappedDek = await kms.wrapDek(kmsKeyRef, dek);
  const sealed = aesGcmEncrypt(dek, bytes);
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

// Open a sealed secret back to its plaintext string. Mirrors decryptSignalValue:
// the envelope's own keyRef is never trusted on its own, it must equal the
// tenant's active key, so a row sealed under a stale or cross-tenant key is
// refused before any unwrap. An unreadable secret is a loud failure, never a
// silent empty string.
export async function decryptSecretString(
  stored: unknown,
  expectedKeyRef: string,
  kms: KmsRuntime = getKmsRuntime(),
): Promise<string> {
  if (!isEncryptedSignalEnvelope(stored)) {
    throw new SignalEncryptionError("stored secret is not an encryption envelope");
  }
  if (stored.keyRef !== expectedKeyRef) {
    throw new SignalEncryptionError(
      "stored secret key reference does not match the tenant's active key",
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
    throw new SignalEncryptionError("secret failed authentication on decrypt");
  }
  return plaintext.toString("utf8");
}
