import { randomBytes, scrypt as scryptCb, type ScryptOptions, timingSafeEqual } from "node:crypto";

// Password hashing uses Node's built-in scrypt. The original spec authorised
// adding bcrypt or argon2, but both ship native addons that are fragile to
// build under this Nix toolchain. scrypt is a strong, memory-hard KDF that is
// already in the standard library, so it is the safer choice here and adds no
// dependency. The stored value is self-describing (algorithm and parameters
// travel with the hash) so the cost can be raised later without breaking
// existing rows. This deviation is logged in the Phase D drift report.
// promisify drops scrypt's options overload, so wrap it by hand to keep the
// cost parameters and a correct Promise<Buffer> return type.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const N = 1 << 15; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// scrypt needs roughly 128 * N * r bytes; the default 32 MiB maxmem is just
// under what N=2^15 requires, so raise the ceiling to avoid a runtime throw.
const MAX_MEM = 64 * 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(plain, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  })) as Buffer;
  return ["scrypt", N, R, P, salt.toString("base64"), derived.toString("base64")].join(":");
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    salt.length === 0 ||
    expected.length === 0
  ) {
    return false;
  }
  const derived = (await scrypt(plain, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: MAX_MEM,
  })) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
