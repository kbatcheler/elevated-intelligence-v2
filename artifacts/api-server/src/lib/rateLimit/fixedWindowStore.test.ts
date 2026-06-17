import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireSecret } from "../secrets/secretStore";
import {
  getFixedWindowStore,
  MemoryFixedWindowStore,
  PostgresFixedWindowStore,
  resetFixedWindowStoreSingleton,
} from "./fixedWindowStore";
import { hashRateLimitKey } from "./keyHash";

// Namespace every key this file writes so it can run against the shared dev DB
// without colliding with another suite or clobbering live counters; cleanup is
// targeted to this prefix, never a global DELETE.
const RUN = `fwtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

afterAll(async () => {
  // The Postgres store keys each row by a SESSION_SECRET-peppered hash, not the
  // raw RUN-prefixed string, so cleanup targets the exact digests this run wrote
  // rather than a LIKE on the plaintext prefix.
  const secret = await requireSecret("SESSION_SECRET");
  for (const k of [`${RUN}-shared`, `${RUN}-reset`]) {
    await db.execute(
      sql`DELETE FROM rate_limit_counters WHERE key = ${hashRateLimitKey(k, secret)}`,
    );
  }
});

describe("MemoryFixedWindowStore", () => {
  let store: MemoryFixedWindowStore;
  beforeEach(() => {
    store = new MemoryFixedWindowStore();
  });

  it("allows up to max within a window, then denies", async () => {
    const k = "k";
    expect((await store.hit(k, 1000, 2, 0)).allowed).toBe(true);
    expect((await store.hit(k, 1000, 2, 0)).allowed).toBe(true);
    expect((await store.hit(k, 1000, 2, 0)).allowed).toBe(false);
  });

  it("resets the window in place once reset_at has passed", async () => {
    const k = "k";
    const first = await store.hit(k, 1000, 1, 0);
    expect(first.allowed).toBe(true);
    expect((await store.hit(k, 1000, 1, 0)).allowed).toBe(false);
    // Past the reset boundary the count starts a fresh window.
    const next = await store.hit(k, 1000, 1, 1500);
    expect(next.allowed).toBe(true);
    expect(next.resetAt).toBe(2500);
  });
});

describe("PostgresFixedWindowStore (shared across simulated instances)", () => {
  it("enforces one limit across two instances drawing on the same key", async () => {
    // Two stores standing in for two app instances behind the proxy. The limit
    // must hold across BOTH, which a per-process map could never do.
    const a = new PostgresFixedWindowStore();
    const b = new PostgresFixedWindowStore();
    const key = `${RUN}-shared`;
    const now = 1_000_000;
    expect((await a.hit(key, 60_000, 3, now)).allowed).toBe(true); // count 1
    expect((await b.hit(key, 60_000, 3, now)).allowed).toBe(true); // count 2
    expect((await a.hit(key, 60_000, 3, now)).allowed).toBe(true); // count 3
    const denied = await b.hit(key, 60_000, 3, now); // count 4, over the shared limit
    expect(denied.allowed).toBe(false);
    expect(denied.resetAt).toBe(now + 60_000);
  });

  it("resets the shared window in place once reset_at has passed", async () => {
    const store = new PostgresFixedWindowStore();
    const key = `${RUN}-reset`;
    const t0 = 2_000_000;
    expect((await store.hit(key, 1000, 1, t0)).allowed).toBe(true);
    expect((await store.hit(key, 1000, 1, t0)).allowed).toBe(false);
    const next = await store.hit(key, 1000, 1, t0 + 5000);
    expect(next.allowed).toBe(true);
    expect(next.resetAt).toBe(t0 + 5000 + 1000);
  });
});

describe("getFixedWindowStore backend selection", () => {
  const prev = process.env["RATE_LIMIT_STORE"];
  afterEach(() => {
    if (prev === undefined) delete process.env["RATE_LIMIT_STORE"];
    else process.env["RATE_LIMIT_STORE"] = prev;
    resetFixedWindowStoreSingleton();
  });

  it("defaults to the in-process map when unset", () => {
    delete process.env["RATE_LIMIT_STORE"];
    resetFixedWindowStoreSingleton();
    expect(getFixedWindowStore()).toBeInstanceOf(MemoryFixedWindowStore);
  });

  it("selects the shared Postgres store only when opted in", () => {
    process.env["RATE_LIMIT_STORE"] = "postgres";
    resetFixedWindowStoreSingleton();
    expect(getFixedWindowStore()).toBeInstanceOf(PostgresFixedWindowStore);
  });

  it("returns the same singleton on repeated reads", () => {
    delete process.env["RATE_LIMIT_STORE"];
    resetFixedWindowStoreSingleton();
    expect(getFixedWindowStore()).toBe(getFixedWindowStore());
  });
});
