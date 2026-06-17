import { createHmac } from "node:crypto";

// The shared rate-limit tables (RATE_LIMIT_STORE=postgres) must never hold a raw
// caller identifier: the auth limiter keys a login attempt by client IP and
// email, and the connector bucket keys by connection id. Persisting those
// verbatim would turn a counter table into a durable log of who tried to log in
// and from where. So the Postgres stores key every row by this keyed, one-way
// hash instead: HMAC-SHA256 under a pepper derived from SESSION_SECRET with a
// domain separator, mirroring the invite-PIN pepper (see lib/auth/pin.ts). The
// digest is deterministic, so it still serves as the upsert primary key, but a
// leak of these tables alone cannot recover the identifier because the pepper
// never lives in the table.
//
// One consequence, the same one the PIN pepper carries: rotating SESSION_SECRET
// changes every digest and so resets the live windows and buckets. That is
// harmless here, because these tables hold only short-lived rate-limit state,
// never durable data.
function ratePepper(sessionSecret: string): Buffer {
  return createHmac("sha256", sessionSecret).update("rate-limit-pepper").digest();
}

// Hash a namespaced limiter key for storage and lookup in the shared tables.
export function hashRateLimitKey(key: string, sessionSecret: string): string {
  return createHmac("sha256", ratePepper(sessionSecret)).update(key).digest("base64");
}
