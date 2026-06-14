import { z } from "zod/v4";

// The on-disk shape of an encrypted derived signal value (Tier 3). In connected
// mode a tenant's derived_signals are encrypted per tenant behind a swappable KMS
// seam: the default is a local, software-only KMS whose key material lives in the
// same database (kms_local_keys), and a customer-managed KMS, where the key never
// enters our database, is the declared upgrade that drops in unchanged. The stored
// value is this envelope, not the plaintext math: a data encryption key seals the
// value, and that data key is itself wrapped by the tenant key behind the KMS seam.
// Our store holds the wrapped data key and a key reference, never the key material
// in the row itself. Revoking the tenant key destroys what the reference points at,
// after which no envelope can be opened: the tenant's data is crypto-shredded.
const base64 = z.string().min(1).max(200000);

export const encryptedSignalEnvelopeSchema = z.strictObject({
  v: z.literal(1),
  alg: z.literal("AES-256-GCM"),
  // The tenant key reference the data encryption key was wrapped under.
  keyRef: z.string().min(1).max(200),
  // The data encryption key, wrapped (encrypted) by the tenant key.
  wrappedDek: base64,
  // The AES-GCM nonce, authentication tag, and ciphertext of the signal value.
  iv: base64,
  tag: base64,
  ct: base64,
});

export type EncryptedSignalEnvelope = z.infer<typeof encryptedSignalEnvelopeSchema>;

export function isEncryptedSignalEnvelope(value: unknown): value is EncryptedSignalEnvelope {
  return encryptedSignalEnvelopeSchema.safeParse(value).success;
}
