import { index, integer, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { committedActionsTable } from "./committedActions";
import { outcomeMeasurementsTable } from "./outcomeMeasurements";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// The Brier-scored calibration ledger (Phase AJ). One row per probabilistic
// forecast the system makes that can later resolve true or false: a predicted
// recovery materialising, a flagged risk occurring, an anomaly proving material,
// a finding surviving challenge, or a Confounder verdict holding up. This
// supersedes Phase W's loose hits-over-resolved calibration with a proper
// probabilistic scoring rule.
//
// Honesty boundaries, the same the rest of the system draws:
// - The probability is assigned by the REAL Evaluator seat at the moment the
//   layer is built, from genuine model output. It is never synthesised from a
//   verdict string or defaulted to a reflexive value; an unresolved forecast
//   simply carries no outcome and no Brier score.
// - outcome, resolvedAt, brierScore and resolutionBasis are all null until the
//   forecast actually resolves, from a real outcome measurement (connected mode)
//   or an owner adjudication (otherwise). A figure is computed from persisted
//   state or it is not shown.
// - The row outlives a user delete (resolvedBy nulls out) so the graded history
//   survives the operator who adjudicated it, mirroring the audit tables.

// What kind of prediction this is. Each kind resolves binary (it happened or it
// did not) within the horizon. confounder_verdict scores the adversarial seat's
// own predictions about explanations, so the Confounder carries published
// accuracy too.
export const forecastKindEnum = pgEnum("forecast_kind", [
  "action_outcome",
  "risk_occurrence",
  "anomaly_materiality",
  "finding_survival",
  "confounder_verdict",
]);

// How a resolution was grounded. "measured" is reserved for a resolution driven
// by a real outcome measurement on a derived signal; "owner" is an operator
// adjudication; "modelled" is a resolution inferred from a modelled (non
// measured) outcome measurement. The honesty boundary mirrors
// outcome_measurements.basis.
export const forecastResolutionBasisEnum = pgEnum("forecast_resolution_basis", [
  "measured",
  "modelled",
  "owner",
]);

export const forecastsTable = pgTable(
  "forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The tenant this forecast was made for. Cascades on delete: a forecast has
    // no meaning without its tenant, and tenant erasure should take its
    // calibration ledger with it.
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // The layer the forecast came from. A plain text key, consistent with
    // committed_actions and tenant_pipeline_runs; the layer registry remains the
    // single source of truth for layer identity, so no foreign key is imposed
    // here (a removed custom layer must not orphan its graded history).
    layerKey: text("layer_key").notNull(),
    // The pipeline run that produced this forecast, or null for a forecast not
    // tied to a layer run. A plain reference with no foreign key, mirroring
    // model_usage.runId: the ledger outlives the run rows it references.
    runId: uuid("run_id"),
    // The sub-stage that emitted the forecast (today always "score": the
    // Evaluator is the single writer of probabilities).
    sourceStage: text("source_stage").notNull(),
    // The product role whose prediction this is, for the per-seat Brier
    // breakdown: "Evaluator" for a layer forecast, "Confounder" for a
    // confounder_verdict forecast. A role label, never a model identifier.
    subjectSeat: text("subject_seat").notNull(),
    // The path the forecast refers to inside the layer it scored, for example
    // "actions[0]", "metrics[2]", or "confounders[1]". Null when the forecast is
    // a layer-level statement with no single anchor.
    sourcePath: text("source_path"),
    // The plain-English resolvable statement the probability is attached to.
    statement: text("statement").notNull(),
    // The assigned probability the statement resolves TRUE, in [0,1]. Numeric,
    // never float, so aggregates do not drift. Four decimal places is ample for a
    // probability.
    probability: numeric("probability", { precision: 5, scale: 4 }).notNull(),
    kind: forecastKindEnum("kind").notNull(),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull().defaultNow(),
    // The horizon by which the forecast should have resolved, computed at
    // creation from the Evaluator's stated horizon in days.
    resolveBy: timestamp("resolve_by", { withTimezone: true }).notNull(),
    // For an action_outcome forecast, the committed action it predicts. Nulls out
    // if that action is deleted, leaving the forecast resolvable by owner
    // adjudication instead of cascading away.
    committedActionId: uuid("committed_action_id").references(() => committedActionsTable.id, {
      onDelete: "set null",
    }),
    // The outcome measurement that resolved this forecast, when it resolved
    // automatically in connected mode. Nulls out if that measurement is deleted.
    outcomeMeasurementId: uuid("outcome_measurement_id").references(
      () => outcomeMeasurementsTable.id,
      { onDelete: "set null" },
    ),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // The realised outcome: 1 if the statement came true, 0 if it did not. Null
    // until resolution; never defaulted to a fabricated 0.
    outcome: integer("outcome"),
    // (probability - outcome)^2, the per-forecast Brier score, persisted at
    // resolution so the rolling aggregates are a plain sum over resolved rows.
    // Null until resolution.
    brierScore: numeric("brier_score", { precision: 8, scale: 6 }),
    resolutionBasis: forecastResolutionBasisEnum("resolution_basis"),
    // The owner who adjudicated the resolution, for an owner-resolved forecast.
    // Null for an automatic measurement-driven resolution. Nulls out on a user
    // delete so the graded history outlives the operator.
    resolvedBy: uuid("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    tenantMadeIdx: index("forecasts_tenant_made_idx").on(t.tenantId, t.madeAt),
    tenantResolvedIdx: index("forecasts_tenant_resolved_idx").on(t.tenantId, t.resolvedAt),
    layerIdx: index("forecasts_layer_idx").on(t.layerKey),
    kindIdx: index("forecasts_kind_idx").on(t.kind),
    subjectSeatIdx: index("forecasts_subject_seat_idx").on(t.subjectSeat),
    resolveByIdx: index("forecasts_resolve_by_idx").on(t.resolveBy),
    actionIdx: index("forecasts_action_idx").on(t.committedActionId),
  }),
);

export type ForecastRow = typeof forecastsTable.$inferSelect;
export type InsertForecast = typeof forecastsTable.$inferInsert;
export type ForecastKind = ForecastRow["kind"];
export type ForecastResolutionBasis = ForecastRow["resolutionBasis"];
