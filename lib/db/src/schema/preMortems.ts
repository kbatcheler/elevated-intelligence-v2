import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { decisionRecordsTable } from "./decisionRecords";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// The on-demand pre-mortem (Phase AL). Attached to a decision record, a
// pre-mortem is a REAL Confounder cortex call that imagines the decision has
// already failed and works backwards: a ranked set of failure modes, each with
// the mechanism by which it would sink the decision and an early-warning
// indicator that would show it taking hold. The indicators are normalised into
// pre_mortem_indicators so the Phase Z push evaluator can watch them with a
// stable, idempotent key, exactly as it watches an outcome shortfall or a
// high-value action.
//
// Honesty boundaries, mirroring the Phase AA interactive challenge:
// - A pre-mortem runs synchronously through the real Confounder seat and records
//   the real billed telemetry. A completed run writes the failure modes, the
//   indicators, and ONE hash-chained provenance entry in a single transaction;
//   a failed run (a model call that returned no usable result) writes an honest
//   failed row with the error and no provenance, never a fabricated forecast of
//   doom.
// - requestedBy nulls out on a user delete so the audit outlives the seat that
//   asked for the pre-mortem.

export const preMortemStatusEnum = pgEnum("pre_mortem_status", ["completed", "failed"]);

export const preMortemsTable = pgTable(
  "pre_mortems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // The decision this pre-mortem examines. Cascades: a pre-mortem has no
    // meaning without its decision, and removing the decision removes its
    // pre-mortems with it.
    decisionRecordId: uuid("decision_record_id")
      .notNull()
      .references(() => decisionRecordsTable.id, { onDelete: "cascade" }),
    // The layer the decision came from, denormalised for display. A plain text
    // key, consistent with the decision record.
    layerKey: text("layer_key").notNull(),
    status: preMortemStatusEnum("status").notNull(),
    // The ranked failure modes the Confounder returned, the full model output
    // retained for audit. Each entry is { rank, title, mechanism, likelihood,
    // earlyWarning }. Null on a failed run.
    failureModes: jsonb("failure_modes").$type<Record<string, unknown>[] | null>(),
    // The Confounder's closing note on residual risk after the failure modes.
    // Null on a failed run or when the model omitted it.
    residualRiskNote: text("residual_risk_note"),
    // Who asked for the pre-mortem. Set null on a user delete so the audit row
    // and its provenance entry survive the authority being removed.
    requestedBy: uuid("requested_by").references(() => usersTable.id, { onDelete: "set null" }),
    // The real (billed) telemetry of the Confounder call, so cost observability
    // holds for a pre-mortem exactly as for a layer build.
    telemetry: jsonb("telemetry").$type<Record<string, unknown>[] | null>(),
    // The contentHash of the provenance entry appended for a completed run. Null
    // on a failed run (no entry is appended).
    provenanceContentHash: text("provenance_content_hash"),
    // The honest failure reason when status is failed.
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("pre_mortems_tenant_idx").on(t.tenantId),
    decisionIdx: index("pre_mortems_decision_idx").on(t.decisionRecordId),
    createdIdx: index("pre_mortems_created_idx").on(t.createdAt),
  }),
);

// One early-warning indicator drawn from a completed pre-mortem's failure modes,
// normalised so the push evaluator can watch it. The indicator is a thing to
// MONITOR, not a fabricated breach: an active indicator on an open committed
// decision is real persisted state the board should be reminded to watch, which
// is what the premortem_indicator push rule surfaces. The dedupe key encodes the
// indicator and its status, so a status change mints a fresh notification while
// an unchanged active indicator never notifies twice.
export const preMortemIndicatorStatusEnum = pgEnum("pre_mortem_indicator_status", [
  "active",
  "triggered",
  "cleared",
]);

export const preMortemIndicatorsTable = pgTable(
  "pre_mortem_indicators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    preMortemId: uuid("pre_mortem_id")
      .notNull()
      .references(() => preMortemsTable.id, { onDelete: "cascade" }),
    decisionRecordId: uuid("decision_record_id")
      .notNull()
      .references(() => decisionRecordsTable.id, { onDelete: "cascade" }),
    layerKey: text("layer_key").notNull(),
    // The rank and title of the failure mode this indicator warns about,
    // snapshotted so the notification reads on its own.
    failureModeRank: integer("failure_mode_rank").notNull(),
    failureModeTitle: text("failure_mode_title").notNull(),
    // The indicator itself: the observable early sign the failure mode is taking
    // hold.
    label: text("label").notNull(),
    status: preMortemIndicatorStatusEnum("status").notNull().default("active"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("pre_mortem_indicators_tenant_idx").on(t.tenantId),
    preMortemIdx: index("pre_mortem_indicators_pre_mortem_idx").on(t.preMortemId),
    decisionIdx: index("pre_mortem_indicators_decision_idx").on(t.decisionRecordId),
    statusIdx: index("pre_mortem_indicators_status_idx").on(t.status),
  }),
);

export type PreMortemRow = typeof preMortemsTable.$inferSelect;
export type InsertPreMortem = typeof preMortemsTable.$inferInsert;
export type PreMortemStatus = PreMortemRow["status"];
export type PreMortemIndicatorRow = typeof preMortemIndicatorsTable.$inferSelect;
export type InsertPreMortemIndicator = typeof preMortemIndicatorsTable.$inferInsert;
export type PreMortemIndicatorStatus = PreMortemIndicatorRow["status"];
