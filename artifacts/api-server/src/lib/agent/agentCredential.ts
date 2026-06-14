import { randomBytes, randomUUID } from "node:crypto";
import { dummyPasswordHash, hashPassword, verifyPassword } from "../auth/password";

// The bearer credential the in-client agent presents. It is two parts joined by
// a single dot: the public agent id (the edge_agents row id, used to look the
// row up) and a high-entropy secret. Only the secret's scrypt hash is stored, so
// the table cannot be replayed if it leaks, and the id is safe to keep in clear
// because it is useless without the secret. The full token is shown to the
// operator exactly once, at issue time.
const SECRET_BYTES = 32;

// The id half must be a uuid: anything else cannot be one of our agent rows, so
// it is rejected before it ever reaches a query (a non-uuid would otherwise make
// Postgres throw on the uuid column rather than returning an honest 401).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NewAgentCredential {
  agentId: string;
  // Shown to the operator once. Never stored.
  token: string;
  // Stored in edge_agents.tokenHash. The secret cannot be recovered from it.
  tokenHash: string;
}

export async function createAgentCredential(): Promise<NewAgentCredential> {
  const agentId = randomUUID();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const tokenHash = await hashPassword(secret);
  return { agentId, token: agentId + "." + secret, tokenHash };
}

export interface ParsedAgentToken {
  agentId: string;
  secret: string;
}

// Parse "Authorization: Bearer <agentId>.<secret>". Returns null for anything
// that is not a well-formed token so the caller can answer a flat 401 without
// leaking which agent ids exist.
export function parseAgentToken(header: string | undefined): ParsedAgentToken | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const raw = match[1].trim();
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot >= raw.length - 1) return null;
  const agentId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!UUID_RE.test(agentId) || secret.length === 0) return null;
  return { agentId, secret };
}

export async function verifyAgentSecret(secret: string, tokenHash: string): Promise<boolean> {
  return verifyPassword(secret, tokenHash);
}

// Spend equivalent scrypt time on a credential miss (unknown or revoked agent)
// so the response timing does not reveal whether an agent id exists.
export async function spendDummyVerify(secret: string): Promise<void> {
  await verifyPassword(secret, await dummyPasswordHash());
}
