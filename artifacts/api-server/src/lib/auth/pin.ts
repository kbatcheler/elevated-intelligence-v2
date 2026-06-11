import { createHmac, randomInt } from "node:crypto";

// Invite PINs are high-entropy single-use tokens, not low-entropy passwords.
// They must be looked up directly by a UNIQUE column at registration, so the
// stored hash has to be deterministic; a salted KDF cannot support that without
// an O(n) scan of every PIN. The correct primitive for a lookupable secret
// token is a keyed hash: HMAC-SHA256 with a server-side pepper. A database leak
// alone does not reveal the codes because the pepper never lives in the table.
//
// The pepper is derived from SESSION_SECRET with a domain separator so the PIN
// key and the session-signing key are independent. One consequence, logged in
// the drift report: rotating SESSION_SECRET invalidates every outstanding PIN.

// Unambiguous alphabet: no 0/O or 1/I. Exactly 32 symbols, so a code is easy to
// read aloud and type. randomInt draws uniformly with internal rejection
// sampling, so there is no modulo bias regardless of alphabet length.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;
const CODE_LENGTH = GROUPS * GROUP_LENGTH;

export function generatePinCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let chunk = "";
    for (let i = 0; i < GROUP_LENGTH; i++) {
      chunk += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    groups.push(chunk);
  }
  return groups.join("-");
}

// Accept the code as a human might retype it (lowercase, spaces, missing or
// extra dashes) and return the single canonical grouped form, or null if it is
// not the right shape. Hashing always runs on the canonical form so equivalent
// inputs map to the same stored hash.
export function canonicalizePinCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("");
  if (cleaned.length !== CODE_LENGTH) return null;
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += GROUP_LENGTH) {
    groups.push(cleaned.slice(i, i + GROUP_LENGTH));
  }
  return groups.join("-");
}

function pinKey(sessionSecret: string): Buffer {
  return createHmac("sha256", sessionSecret).update("pin-pepper").digest();
}

// Hash a canonical PIN code for storage and lookup. The result is deterministic
// for a given code and secret, which is what makes the UNIQUE codeHash column
// and direct lookup work.
export function hashPinCode(canonicalCode: string, sessionSecret: string): string {
  return createHmac("sha256", pinKey(sessionSecret)).update(canonicalCode).digest("base64");
}

export type PinState = "active" | "revoked" | "expired" | "used-up";

// Pure state machine over a PIN row. Used both to label PINs in the owner
// console and to reason about validity. The actual consume at registration is
// done with a conditional UPDATE inside a transaction so it is race-safe, but
// the four failure states it guards against are exactly these.
export function pinState(
  pin: { revokedAt: Date | null; expiresAt: Date; useCount: number; maxUses: number },
  now: Date = new Date(),
): PinState {
  if (pin.revokedAt !== null) return "revoked";
  if (pin.expiresAt.getTime() <= now.getTime()) return "expired";
  if (pin.useCount >= pin.maxUses) return "used-up";
  return "active";
}
