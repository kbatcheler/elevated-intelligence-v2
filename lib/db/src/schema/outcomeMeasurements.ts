import { index, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { committedActionsTable } from "./committedActions";
import { usersTable } from "./users";

// The outcome loop (Phase W). One row per real measurement a provider records
// against a committed action: what the action actually realized, on what basis,
// and how it stands against the prediction snapshotted at commit time. This is
// where the track record stops being a list of intentions and becomes a graded
// history.
//
// The honesty boundary is the basis column. "measured" is reserved for an
// outcome grounded in a real derived signal reading; an operator estimate is
// "modelled" and is never presented as measured fact. A figure is computed from
// persisted state or it is not shown, so realizedValueUsd, actualMetric and
// varianceVsPrediction are all nullable rather than defaulted to a fabricated
// zero.
export const outcomeMeasurementBasisEnum = pgEnum("outcome_measurement_basis", [
  "measured",
  "modelled",
]);

// The graded standing of the action at the time of the measurement, derived in
// the service from the numbers, never accepted raw from the client:
// - pending: a measurement exists but no realized dollar value is recorded yet.
// - on_track: a realized value is recorded and is progressing, but has not yet
//   met the prediction, or the action carries no numeric prediction to grade.
// - realized: the realized value met or exceeded the prediction.
// - missed: a final measurement closed the action out below its prediction.
// "missed" is only ever set on a final measurement, so an in-flight action is
// never spuriously graded as a miss.
export const outcomeMeasurementStatusEnum = pgEnum("outcome_measurement_status", [
  "pending",
  "on_track",
  "realized",
  "missed",
]);

export const outcomeMeasurementsTable = pgTable(
  "outcome_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The committed action this measurement grades. Cascades on delete: a
    // measurement has no meaning without its action, and committed actions
    // themselves cascade from the tenant.
    actionId: uuid("action_id")
      .notNull()
      .references(() => committedActionsTable.id, { onDelete: "cascade" }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
    // The raw metric observed at measurement time. Populated from a real derived
    // signal when basis is measured; null when the measurement is a modelled
    // estimate with no underlying signal reading.
    actualMetric: numeric("actual_metric"),
    // The realized dollar value the operator records. Null when only a metric was
    // observed and no dollar realization has been quantified yet.
    realizedValueUsd: numeric("realized_value_usd", { precision: 14, scale: 2 }),
    // realizedValueUsd minus the action's predictedValueUsd, in dollars. Null when
    // either side is absent, because a variance against nothing is not a number.
    varianceVsPrediction: numeric("variance_vs_prediction", { precision: 14, scale: 2 }),
    basis: outcomeMeasurementBasisEnum("basis").notNull(),
    status: outcomeMeasurementStatusEnum("status").notNull(),
    note: text("note"),
    // The provider who recorded the measurement. Nulls out on a user delete so
    // the graded history outlives the operator, mirroring the audit tables.
    recordedBy: uuid("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actionIdx: index("outcome_measurements_action_idx").on(t.actionId),
    measuredIdx: index("outcome_measurements_measured_idx").on(t.measuredAt),
  }),
);

export type OutcomeMeasurementRow = typeof outcomeMeasurementsTable.$inferSelect;
export type InsertOutcomeMeasurement = typeof outcomeMeasurementsTable.$inferInsert;
export type OutcomeMeasurementBasis = OutcomeMeasurementRow["basis"];
export type OutcomeMeasurementStatus = OutcomeMeasurementRow["status"];
