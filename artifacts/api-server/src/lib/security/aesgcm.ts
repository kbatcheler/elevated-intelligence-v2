import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Low-level AES-256-GCM, built only on node:crypto. It is used in two places:
// wrapping a per-signal data encryption key inside the KMS seam, and sealing the
// derived signal value under that data key. The key must be 32 bytes. The nonce
// is 96 bits, generated fresh per call; the 128-bit authentication tag is
// returned alongside so any tampering is detected on decrypt.
const ALG = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface AesGcmParts {
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

export function aesGcmEncrypt(key: Buffer, plaintext: Buffer): AesGcmParts {
  if (key.length !== KEY_BYTES) {
    throw new Error("AES-256-GCM requires a 32-byte key");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ct };
}

export function aesGcmDecrypt(key: Buffer, parts: AesGcmParts): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error("AES-256-GCM requires a 32-byte key");
  }
  if (parts.tag.length !== TAG_BYTES) {
    throw new Error("AES-256-GCM requires a 16-byte authentication tag");
  }
  const decipher = createDecipheriv(ALG, key, parts.iv);
  decipher.setAuthTag(parts.tag);
  return Buffer.concat([decipher.update(parts.ct), decipher.final()]);
}

// Pack the three parts into one base64 string (iv | tag | ciphertext) and back.
// Used by the KMS to store a wrapped data key as a single opaque reference.
export function packParts(parts: AesGcmParts): string {
  return Buffer.concat([parts.iv, parts.tag, parts.ct]).toString("base64");
}

export function unpackParts(packed: string): AesGcmParts {
  const blob = Buffer.from(packed, "base64");
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("packed AES-GCM blob is too short to be valid");
  }
  return {
    iv: blob.subarray(0, IV_BYTES),
    tag: blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
    ct: blob.subarray(IV_BYTES + TAG_BYTES),
  };
}
