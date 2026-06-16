import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { committedActionsTable } from "./committedActions";
import { forecastsTable } from "./forecasts";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// One provenance reference grounding the recommendation at decision time. It is a
// pointer into the append-only ledger (the claimPath the layer's diagnosis was
// chained under, and the contentHash of the entry), never raw evidence data. The
// set is snapshotted on the decision so the board audit can show WHAT grounded the
// advice when it was acted on, even after the layer is later refreshed.
export interface DecisionEvidenceRef {
  claimPath: string;
  contentHash: string;
}

// The decision ledger (Phase AL). One row per board-grade DECISION a human takes
// on a recommended action: a commit, a defer, or a reject. The ledger is what
// turns the platform from an advisor that talks into an advisor that is held to
// account: every decision records WHAT was decided, WHO decided it, WHEN, the
// system's recommendation and confidence AT THAT MOMENT (snapshotted, never read
// back from the mutable layer content), the human's rationale, and a link to the
// AJ forecast for the action. "Overruled and right" is derivable: a decision
// that contradicted the recommendation whose linked forecast later resolved in
// the human's favour.
//
// Honesty boundaries, the same the rest of the system draws:
// - The recommendation snapshot is captured at decision time from the real
//   committed action (a commit) or the real layer content (a defer or reject).
//   recommendationHash binds the row to the EXACT recommendation it acted on, so
//   a later refresh of the layer can never silently re-point the audit.
// - A decision is a recorded human act, not a model call: it always appends one
//   hash-chained provenance entry, so provenanceContentHash is never null. The
//   on-demand pre-mortem (pre_mortems) is the model call, and it carries its own
//   honest completed-or-failed lifecycle.
// - decidedBy nulls out on a user delete so the board audit outlives the seat
//   that took the decision, mirroring the forecasts and finding_challenges rows.

// The three decisions a human can record against a recommended action. A commit
// also creates a committed action (the existing Phase W path); a defer or reject
// records the decision without committing, so the recommendation is left in the
// diagnosis and the audit captures that it was deliberately not taken.
export const decisionKindEnum = pgEnum("decision_kind", ["commit", "defer", "reject"]);

export const decisionRecordsTable = pgTable(
  "decision_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // The layer the recommended action came from. A plain text key, consistent
    // with committed_actions and forecasts; the layer registry remains the single
    // source of truth, so no foreign key is imposed (a removed custom layer must
    // not orphan the board audit of a decision already taken on it).
    layerKey: text("layer_key").notNull(),
    // The path into the layer content the decision acted on, e.g. "actions[0]".
    // Null for a legacy commit that recorded no ref; the snapshot fields below
    // still carry the real recommendation in that case.
    actionRef: text("action_ref"),
    decision: decisionKindEnum("decision").notNull(),
    // For a commit, the committed action this decision created. Nulls out if that
    // action is later deleted, leaving the decision audit intact. Always null for
    // a defer or reject, which create no committed action.
    committedActionId: uuid("committed_action_id").references(() => committedActionsTable.id, {
      onDelete: "set null",
    }),
    // Who took the decision. Set null on a user delete so the audit and its
    // provenance entry survive the authority being removed.
    decidedBy: uuid("decided_by").references(() => usersTable.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    // The system recommendation snapshotted at decision time. These are the words
    // and figures the intelligence actually put forward, captured so the audit
    // reflects what was recommended rather than a later, refreshed version.
    recommendedTitle: text("recommended_title").notNull(),
    recommendedDetail: text("recommended_detail"),
    recommendedImpact: text("recommended_impact"),
    // The numeric dollar value parsed from the recommended impact at decision
    // time, when the impact names a real currency figure. Null when the impact
    // carries no parseable dollar amount; the platform never invents one.
    recommendedValueUsd: numeric("recommended_value_usd", { precision: 14, scale: 2 }),
    // The recommendation's confidence (0 to 100) and basis (verified or modelled)
    // at decision time.
    systemConfidence: integer("system_confidence").notNull(),
    systemBasis: text("system_basis").notNull(),
    // sha256 over the canonical recommendation snapshot. It binds the decision to
    // the EXACT recommendation it acted on; a later refresh that changes the
    // action is honestly shown as a different recommendation, never re-pointed.
    recommendationHash: text("recommendation_hash").notNull(),
    // Whether the recommendation snapshot was read SERVER-SIDE from the persisted
    // layer content (a defer or reject, and a commit that named an actionRef) or
    // came from the client with no system reference (a freeform commit). The board
    // audit must never present an operator-typed action as a verified system
    // recommendation, so this flag is the honest distinction. Defaults true; only
    // a no-ref commit records false.
    recommendationVerified: boolean("recommendation_verified").notNull().default(true),
    // The provenance refs grounding the layer's diagnosis at decision time: the
    // ledger entries the recommendation rested on, snapshotted so the audit shows
    // the evidence as it stood when the decision was taken. References only, never
    // raw evidence; an empty array is the honest state for a layer with no graded
    // claims yet (an outside-in tenant), never fabricated.
    evidenceRefs: jsonb("evidence_refs")
      .$type<DecisionEvidenceRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // The human's stated reason. Context for the audit; required by the route for
    // a defer or reject, optional for a commit. Always dash-sanitised.
    rationale: text("rationale"),
    // True when the decision did not follow the recommendation (a defer or a
    // reject of a recommended action). A commit follows it, so this is false.
    // Computed once at decision time, never re-derived from mutable state.
    contradictsRecommendation: boolean("contradicts_recommendation").notNull(),
    // The AJ action_outcome forecast for this action, snapshotted by reference.
    // Nulls out if that forecast is deleted. A commit binds the forecast to its
    // committed action through the existing resolution path; a defer or reject
    // only records the reference, leaving the forecast unbound.
    forecastId: uuid("forecast_id").references(() => forecastsTable.id, { onDelete: "set null" }),
    // The contentHash of the provenance entry appended for this decision. A
    // decision always appends one entry, so this is never null.
    provenanceContentHash: text("provenance_content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("decision_records_tenant_idx").on(t.tenantId),
    layerActionIdx: index("decision_records_layer_action_idx").on(
      t.tenantId,
      t.layerKey,
      t.actionRef,
    ),
    committedActionIdx: index("decision_records_committed_action_idx").on(t.committedActionId),
    forecastIdx: index("decision_records_forecast_idx").on(t.forecastId),
    createdIdx: index("decision_records_created_idx").on(t.createdAt),
  }),
);

export type DecisionRecordRow = typeof decisionRecordsTable.$inferSelect;
export type InsertDecisionRecord = typeof decisionRecordsTable.$inferInsert;
export type DecisionKind = DecisionRecordRow["decision"];
