import { bigint, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Shared, Postgres-backed rate-limit state (Phase D and O hardening). Both the
// auth fixed-window limiter and the per-connection token bucket default to an
// in-process map (the single-VM target). When RATE_LIMIT_STORE=postgres is set,
// they instead share state through these two tables so the effective limit and
// quota hold across more than one instance, where a per-process map would let
// each instance keep its own counter and multiply the budget by the instance
// count. The default is unchanged; these tables are written only on the opt-in
// shared path. They hold no secret and no raw client identifier: the key column
// is a one-way HMAC of the caller-derived key (an IP, a login email, an
// ingestion key id, a source id, or a connection id) under a SESSION_SECRET
// pepper, so a leak of these tables alone reveals neither who was limited nor
// from where, and they carry no tenant reference and no FK.

// The fixed-window counter for the auth and ingestion limiters. One row per
// (limiter name + caller key); the window resets in place when reset_at_ms has
// passed. Times are epoch milliseconds so the atomic upsert can compute the
// window in one statement without a clock round trip.
export const rateLimitCountersTable = pgTable("rate_limit_counters", {
  // A one-way HMAC of the namespaced key (the limiter name plus the caller-
  // derived key), so two limiters that derive the same caller key never share a
  // counter and the raw IP or email is never stored.
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAtMs: bigint("reset_at_ms", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type RateLimitCounter = typeof rateLimitCountersTable.$inferSelect;
export type InsertRateLimitCounter = typeof rateLimitCountersTable.$inferInsert;

// The per-connection token bucket for the connector runtime. One row per
// connection id; tokens accrue from the elapsed wall time on each take and the
// row goes negative to reserve a token under contention, exactly as the
// in-memory bucket does, but shared so concurrent instances draw from one
// bucket. Bounded by the number of connections, so it needs no FK to stay
// bounded; a stale row for a removed connection is harmless and swept lazily.
export const rateLimitBucketsTable = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  lastRefillMs: bigint("last_refill_ms", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type RateLimitBucket = typeof rateLimitBucketsTable.$inferSelect;
export type InsertRateLimitBucket = typeof rateLimitBucketsTable.$inferInsert;
