import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// Phase X: Benchmarking and the Data Network Effect.
//
// A benchmark here is a distribution statistic over a cohort, never a comparison
// to named companies. The privacy boundary is structural, not a runtime promise:
// the cohort and stat tables hold NO tenant reference at all (no column, no FK),
// so no query and no join can walk from a published stat back to a contributing
// tenant. Only the consent log and the recompute audit reference users, and the
// consent log is the only place a tenant id appears in this subsystem.

// One row per opt-in or opt-out. tenantId and authorityUserId null out on delete
// (mirroring retention_events/backup_events) so the consent log outlives the
// tenant and the operator it describes. This is the "consent state is logged"
// evidence the milestone requires.
export const benchmarkConsentActionEnum = pgEnum("benchmark_consent_action", [
  "opt_in",
  "opt_out",
]);

export const benchmarkConsentEventsTable = pgTable(
  "benchmark_consent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
    action: benchmarkConsentActionEnum("action").notNull(),
    // The human who changed the consent state, recorded with the role verbatim so
    // the audit reads even after the user row is gone.
    authorityUserId: uuid("authority_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    authorityRole: text("authority_role").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("benchmark_consent_events_tenant_idx").on(t.tenantId),
    createdIdx: index("benchmark_consent_events_created_idx").on(t.createdAt),
  }),
);

// A cohort is a segment (industry plus revenue band) and an aggregate member
// count. DELIBERATELY no tenant references: a cohort is a population, not a
// roster. The sector and revenueBand columns are the normalized segment LABELS
// shared by every member, not any one tenant's identity. The whole row is the
// superseded output of a recompute, never edited in place.
export const benchmarkCohortsTable = pgTable(
  "benchmark_cohorts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    segmentKey: text("segment_key").notNull().unique(),
    sector: text("sector").notNull(),
    revenueBand: text("revenue_band").notNull(),
    memberCount: integer("member_count").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    computedIdx: index("benchmark_cohorts_computed_idx").on(t.computedAt),
  }),
);

// One row per (cohort segment, layer, signal) distribution. DELIBERATELY no
// tenant references at all: only the segment key, the metric identity, the unit,
// and the percentile distribution over the cohort. A stat is persisted ONLY when
// at least k distinct tenants contributed the metric (the hard k-anonymity gate),
// so a published row never describes fewer than k companies. numeric arrives as a
// string over the wire; callers parse it for math and display.
export const benchmarkStatsTable = pgTable(
  "benchmark_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cohortSegmentKey: text("cohort_segment_key").notNull(),
    layerKey: text("layer_key").notNull(),
    signalKey: text("signal_key").notNull(),
    // The window the metric was computed over (e.g. a trailing period), or null
    // for an unwindowed measure. It is a cohort dimension: a distribution pools
    // only like-for-like windows, so two tenants are never compared across
    // different periods of the same signal.
    window: text("window"),
    p25: numeric("p25").notNull(),
    p50: numeric("p50").notNull(),
    p75: numeric("p75").notNull(),
    // How many distinct tenants contributed this metric. Always >= the configured
    // minimum cohort size, because a sub-threshold metric is never written.
    sampleCount: integer("sample_count").notNull(),
    // True when bounded privacy noise was applied to the percentiles (a small
    // cohort near the k threshold). Disclosed, never hidden: the UI labels a
    // noised stat "privacy protected" so the basis is honest.
    noised: boolean("noised").notNull().default(false),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    segmentIdx: index("benchmark_stats_segment_idx").on(t.cohortSegmentKey),
    lookupIdx: index("benchmark_stats_lookup_idx").on(
      t.cohortSegmentKey,
      t.layerKey,
      t.signalKey,
    ),
  }),
);

// One row per recompute run. Identity-free by construction: run-level counts
// only, never a contributor list and never a per-cohort tenant breakdown. It is
// the owner-review evidence that a recompute happened, what it produced, and how
// many opted-in tenants were skipped because their signals were unreadable.
export const benchmarkEventActionEnum = pgEnum("benchmark_event_action", ["recompute"]);

export const benchmarkEventsTable = pgTable(
  "benchmark_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: benchmarkEventActionEnum("action").notNull(),
    cohortCount: integer("cohort_count").notNull().default(0),
    statCount: integer("stat_count").notNull().default(0),
    // Opted-in tenants whose signals were unreadable (revoked or missing key) and
    // were skipped this run. A count only, never which tenants.
    skippedTenantCount: integer("skipped_tenant_count").notNull().default(0),
    minCohort: integer("min_cohort").notNull(),
    // The human who triggered a manual recompute. Null for a scheduled run, whose
    // authority is the system scheduler itself (authorityRole "system").
    authorityUserId: uuid("authority_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    authorityRole: text("authority_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("benchmark_events_created_idx").on(t.createdAt),
  }),
);

export type BenchmarkConsentEventRow = typeof benchmarkConsentEventsTable.$inferSelect;
export type InsertBenchmarkConsentEvent = typeof benchmarkConsentEventsTable.$inferInsert;
export type BenchmarkCohortRow = typeof benchmarkCohortsTable.$inferSelect;
export type InsertBenchmarkCohort = typeof benchmarkCohortsTable.$inferInsert;
export type BenchmarkStatRow = typeof benchmarkStatsTable.$inferSelect;
export type InsertBenchmarkStat = typeof benchmarkStatsTable.$inferInsert;
export type BenchmarkEventRow = typeof benchmarkEventsTable.$inferSelect;
export type InsertBenchmarkEvent = typeof benchmarkEventsTable.$inferInsert;
