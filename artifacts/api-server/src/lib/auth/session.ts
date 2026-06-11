import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@workspace/db";

// Sessions are stateless and signed, never stored server-side. The cookie value
// is base64url(JSON payload) + "." + HMAC-SHA256(payload). The signature proves
// the payload was issued by this server; the per-request user lookup in
// requireAuth then reloads role and status from the database so a disabled user
// is rejected immediately rather than staying valid until the cookie expires.
export interface SessionPayload {
  userId: string;
  role: UserRole;
  iat: number; // issued-at, unix seconds
}

export const SESSION_COOKIE = "ei_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return body + "." + sign(body, secret);
}

export function verifySession(
  token: string,
  secret: string,
  now: Date = new Date(),
): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(body, secret);

  // Compare fixed-length SHA-256 digests so timingSafeEqual never throws on a
  // length mismatch and the comparison stays constant-time.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload?.userId !== "string" ||
    typeof payload?.role !== "string" ||
    typeof payload?.iat !== "number"
  ) {
    return null;
  }
  if (Math.floor(now.getTime() / 1000) - payload.iat > SESSION_TTL_SECONDS) return null;
  return payload;
}
