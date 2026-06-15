import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// Proactive Push Intelligence (Phase Z). This is deliberately a SEPARATE seam
// from the Phase O/P operational alert seam (alert_events). Those are connector
// and ops health events for the provider-owner; THESE are business-intelligence
// notifications for any seat, ranked by predicted dollar impact and confidence,
// recorded once per breach (idempotent), surfaced in an in-app notification
// center, and delivered as a scheduled Morning Brief digest to a chosen channel.
// New enums on purpose, never reusing alert_notification_status, so the two
// lifecycles can diverge without entangling.

// The kinds of breach a rule watches. Only the two below are implemented in this
// phase; both are computed entirely from already-persisted state (a graded
// outcome measurement, a committed action), never fabricated. More kinds are a
// later phase and an additive enum value, not a reinterpretation of these.
export const pushRuleTypeEnum = pgEnum("push_rule_type", [
  "outcome_shortfall",
  "high_value_action",
]);

// Where a delivered digest goes. in_app is the always-available default (the
// notification center); slack and email are external sinks, the latter wired as
// an available-not-connected adapter.
export const pushChannelEnum = pgEnum("push_channel", ["in_app", "slack", "email"]);

// The external-delivery lifecycle of one event. A non-suppressed event is born
// pending and the Morning Brief drainer flips it to sent or failed exactly once;
// a below-threshold, muted, or disabled candidate is born suppressed and never
// delivered externally (but stays visible in the center, so nothing is lost).
export const pushDeliveryStatusEnum = pgEnum("push_delivery_status", [
  "pending",
  "suppressed",
  "sent",
  "failed",
]);

// A per-user, per-tenant, per-kind rule. Every rule belongs to exactly one user
// (ownerUserId is NOT NULL): the notification center, read-state, mute and
// threshold tuning are all per-user, so one user muting a kind never silences
// another user's signal. A rule is materialized lazily (a default, enabled, no
// floor) for each tenant a user can reach, and the user tunes it from there.
export const pushRulesTable = pgTable(
  "push_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: pushRuleTypeEnum("type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // When set and in the future, the rule still evaluates but its events are
    // recorded suppressed rather than delivered, so a mute hides noise without
    // dropping the record. Null means not muted.
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    // Suppression thresholds. Null means "no floor" for that dimension: every
    // breach qualifies. A real number suppresses anything below it. Never a
    // fabricated default that would hide signal silently; the default rule has
    // no floor and the user opts into one.
    minImpactUsd: numeric("min_impact_usd", { precision: 14, scale: 2 }),
    minConfidence: integer("min_confidence"),
    channel: pushChannelEnum("channel").notNull().default("in_app"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    ownerIdx: index("push_rules_owner_idx").on(t.ownerUserId),
    uniqueRule: unique("push_rules_owner_tenant_type_unique").on(
      t.ownerUserId,
      t.tenantId,
      t.type,
    ),
  }),
);

// One recorded notification. Idempotent by (ruleId, dedupeKey): the same breach
// in the same state produces the same key, so re-evaluation is a no-op rather
// than a duplicate; a state CHANGE produces a new key and a new event. Every
// figure (impactUsd, confidence, rankScore) is computed from persisted state or
// is null; rankScore is impactUsd * (confidence/100), zero when unquantified, so
// an event with no dollar figure ranks last and is suppressed, never promoted.
export const pushEventsTable = pgTable(
  "push_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => pushRulesTable.id, { onDelete: "cascade" }),
    // Denormalized owner so the inbox is a single-table filter and the access
    // check is belt-and-suspenders (owner is me AND tenant is one I can reach).
    // Cascades with the rule's owner.
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Denormalized tenant for display and filtering. Nulls out on a tenant
    // delete; the rule and its events cascade away with the tenant, so this is
    // defensive continuity, not a long-lived audit trail.
    tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
    // Which domain object triggered this, so a console can link and the dedupe
    // key is anchored to a real row. "outcome_measurement" | "committed_action".
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    impactUsd: numeric("impact_usd", { precision: 14, scale: 2 }),
    confidence: integer("confidence"),
    rankScore: numeric("rank_score", { precision: 18, scale: 4 }).notNull(),
    deliveryStatus: pushDeliveryStatusEnum("delivery_status").notNull().default("pending"),
    // The channel this event is destined for, snapshotted from the rule at
    // creation so a later channel change never rewrites delivered history.
    channel: pushChannelEnum("channel").notNull().default("in_app"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("push_events_owner_idx").on(t.ownerUserId),
    statusIdx: index("push_events_status_idx").on(t.deliveryStatus),
    createdIdx: index("push_events_created_idx").on(t.createdAt),
    uniqueDedupe: unique("push_events_rule_dedupe_unique").on(t.ruleId, t.dedupeKey),
  }),
);

export type PushRuleRow = typeof pushRulesTable.$inferSelect;
export type InsertPushRule = typeof pushRulesTable.$inferInsert;
export type PushRuleType = PushRuleRow["type"];
export type PushChannel = PushRuleRow["channel"];
export type PushEventRow = typeof pushEventsTable.$inferSelect;
export type InsertPushEvent = typeof pushEventsTable.$inferInsert;
export type PushDeliveryStatus = PushEventRow["deliveryStatus"];
