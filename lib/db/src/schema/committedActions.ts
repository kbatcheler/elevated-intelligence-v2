import { integer, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// The honest lifecycle of a committed action. These are states a human sets as
// they work the action, never a fabricated outcome: the platform records that an
// action was committed and how far along it is, but it does not invent a
// realized recovery. Outcome verification against actuals is a later phase.
export const committedActionStatusEnum = pgEnum("committed_action_status", [
  "committed",
  "in_progress",
  "done",
  "dismissed",
]);

// A prescriptive action a user has committed to from a layer. The predicted
// recovery, basis and confidence are captured from the real generated action at
// the moment of commit, so the track record reflects what the intelligence
// actually said rather than a number entered later.
export const committedActionsTable = pgTable("committed_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  // The layer the action came from. A plain text key, consistent with the
  // pipeline runs table; the registry remains the source of truth for identity.
  layerKey: text("layer_key").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  // The predicted recovery captured from the action at commit time. A
  // prediction, never a realized outcome.
  predictedImpact: text("predicted_impact"),
  // The numeric dollar value parsed out of predictedImpact at commit time, when
  // the action names a real currency figure (for example "$2.4M recovery" stores
  // 2400000.00). Null when the impact carries no parseable dollar amount: a bare
  // percentage, a margin-point figure, or prose. The platform never invents a
  // number, so an unparseable impact simply has no numeric prediction.
  predictedValueUsd: numeric("predicted_value_usd", { precision: 14, scale: 2 }),
  // The metric the action set out to move, snapshotted at commit time from a
  // single real derived signal when the tenant is connected and a signal was
  // named on commit. Null in outside-in mode, where no measured baseline exists.
  // Honest absence, never a fabricated starting point.
  baselineMetric: numeric("baseline_metric"),
  baselineAt: timestamp("baseline_at", { withTimezone: true }),
  timing: text("timing"),
  // The business owner the action names (for example "CFO"), distinct from the
  // user who committed it.
  actionOwner: text("action_owner"),
  // verified or modelled, captured from the action at commit time.
  basis: text("basis").notNull(),
  // The action confidence at commit time, 0 to 100.
  confidence: integer("confidence").notNull(),
  status: committedActionStatusEnum("status").notNull().default("committed"),
  note: text("note"),
  committedBy: uuid("committed_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  committedAt: timestamp("committed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CommittedAction = typeof committedActionsTable.$inferSelect;
export type InsertCommittedAction = typeof committedActionsTable.$inferInsert;
export type CommittedActionStatus = CommittedAction["status"];
