import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { layersTable } from "./layers";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// Interactive Challenge (Phase AA). A seat can challenge a specific finding in a
// tenant's diagnosis; the challenge routes to the Confounder (Gemini) and the
// Synthesist (Claude) seats to RE-REASON that one finding and return either
// "upheld" (with reasoning) or "revised" (with a new confidence and a note).
//
// The user's input is CONTEXT, never an override: a challenge can never delete
// or overwrite a finding. The finding in tenant_layers is left untouched; this
// table is an append-only OVERLAY recorded alongside it, and a completed
// challenge also appends one hash-chained provenance entry, so every exchange is
// auditable. A revised finding's basis becomes "modelled_user_informed", a value
// recorded here only and deliberately NOT folded into the cortex basis enum
// (verified|modelled), which stays the score stage's strict, owned vocabulary.

// The lifecycle of one challenge. It runs synchronously in the request: a
// completed challenge carries an outcome and a re-reasoning; a failed one (a
// model call that did not return a usable result) carries an honest error and no
// outcome, never a fabricated uphold or revise.
export const findingChallengeStatusEnum = pgEnum("finding_challenge_status", [
  "completed",
  "failed",
]);

// The re-reasoning verdict. "upheld" keeps the finding as it stands (with
// reasoning); "revised" attaches a new confidence and a note. Neither deletes
// the finding. Null until (and unless) the challenge completes.
export const findingChallengeOutcomeEnum = pgEnum("finding_challenge_outcome", [
  "upheld",
  "revised",
]);

export const findingChallengesTable = pgTable(
  "finding_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    layerKey: text("layer_key")
      .notNull()
      .references(() => layersTable.key, { onDelete: "restrict" }),
    // A stable reference to the challenged finding inside the layer content, e.g.
    // "causes[0]" or "actions[1]". Claims carry no id of their own, so the ref is
    // the claim kind plus its index.
    findingRef: text("finding_ref").notNull(),
    // sha256 over the EXACT challenged finding's canonical text. It binds the
    // challenge to the precise version it addressed: if the layer is later
    // refreshed and the finding text changes, the challenge is honestly shown as
    // addressing a prior version rather than silently re-pointed.
    findingHashRef: text("finding_hash_ref").notNull(),
    // The challenged finding's title, snapshotted for display and audit so the
    // history reads even after a refresh changes the live content.
    findingTitle: text("finding_title").notNull(),
    // Who challenged. Set null (not cascade) on a user delete so the audit row
    // and its provenance entry survive the authority being removed.
    challengerUserId: uuid("challenger_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // The user's objection or added context. CONTEXT, never an override.
    challengeText: text("challenge_text").notNull(),
    status: findingChallengeStatusEnum("status").notNull(),
    outcome: findingChallengeOutcomeEnum("outcome"),
    // The finding's confidence and basis snapshotted at challenge time.
    originalConfidence: integer("original_confidence"),
    originalBasis: text("original_basis"),
    // Populated only on a revise. revisedBasis is always "modelled_user_informed"
    // when set; it lives here, not in the layer content or the cortex enum.
    revisedConfidence: integer("revised_confidence"),
    revisedBasis: text("revised_basis"),
    // The Confounder's re-examination note and the Synthesist's uphold-or-revise
    // reasoning. Null on a failed run.
    confounderNote: text("confounder_note"),
    reasoning: text("reasoning"),
    // The honest failure reason when status is failed.
    error: text("error"),
    // The two seats' real telemetry (seat, model, latency, tokens, billed), so
    // cost observability holds for a challenge exactly as for a layer build.
    telemetry: jsonb("telemetry").$type<Record<string, unknown>[] | null>(),
    // The contentHash of the provenance entry appended for a completed challenge,
    // stored for audit display. Null on a failed run (no entry is appended).
    provenanceContentHash: text("provenance_content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("finding_challenges_tenant_idx").on(t.tenantId),
    layerFindingIdx: index("finding_challenges_layer_finding_idx").on(
      t.tenantId,
      t.layerKey,
      t.findingRef,
    ),
    createdIdx: index("finding_challenges_created_idx").on(t.createdAt),
  }),
);

export type FindingChallengeRow = typeof findingChallengesTable.$inferSelect;
export type InsertFindingChallenge = typeof findingChallengesTable.$inferInsert;
export type FindingChallengeStatus = FindingChallengeRow["status"];
export type FindingChallengeOutcome = NonNullable<FindingChallengeRow["outcome"]>;
