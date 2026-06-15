import { randomBytes, randomUUID } from "node:crypto";
import { dummyPasswordHash, hashPassword, verifyPassword } from "../auth/password";

// The per-tenant ingestion credential, mirroring the in-client agent credential
// (agentCredential.ts). The token is "<keyId>.<secret>": the keyId is the public
// ingestion_keys row id carried so the server can look up the row, and the
// secret half is verified against the stored scrypt hash. Only the hash is
// persisted; the secret is shown to the operator exactly once at issue time.
const SECRET_BYTES = 32;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NewIngestionKey {
  keyId: string;
  token: string;
  tokenHash: string;
}

export async function createIngestionKey(): Promise<NewIngestionKey> {
  const keyId = randomUUID();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const tokenHash = await hashPassword(secret);
  return { keyId, token: keyId + "." + secret, tokenHash };
}

export interface ParsedIngestionToken {
  keyId: string;
  secret: string;
}

// Parse an "Authorization: Bearer <keyId>.<secret>" header into its two halves,
// or null when it is absent or malformed. The keyId must be a UUID and the
// secret non-empty; anything else is treated as no credential.
export function parseIngestionToken(header: string | undefined): ParsedIngestionToken | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const raw = match[1]!.trim();
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot >= raw.length - 1) return null;
  const keyId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!UUID_RE.test(keyId) || secret.length === 0) return null;
  return { keyId, secret };
}

export async function verifyIngestionSecret(secret: string, tokenHash: string): Promise<boolean> {
  return verifyPassword(secret, tokenHash);
}

// Spend the same scrypt time on the miss path (unknown or revoked key id) so
// timing does not leak whether a key id exists.
export async function spendDummyVerify(secret: string): Promise<void> {
  await verifyPassword(secret, await dummyPasswordHash());
}
