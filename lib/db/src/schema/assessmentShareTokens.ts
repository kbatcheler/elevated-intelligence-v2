import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assessmentSubmissionsTable } from "./assessmentSubmissions";

// The Intelligence Gap Assessment forwardable link (Phase AT). Mirrors the
// Phase AB diagnosis share token exactly: the opaque token is shown to the
// minter once and is never persisted, only its sha256 hash is stored, and a
// presented token resolves by hashing and matching one unexpired, unrevoked row.
//
// Two deliberate differences from diagnosisShareTokens, both because the
// assessment is anonymous and pre-auth:
// - it references an assessment_submissions row, not a tenant, ON DELETE CASCADE
//   so deleting a submission removes its links, and
// - there is no createdBy user: the minter is a cold prospect with no session,
//   so there is no operator identity to record.
export const assessmentShareTokensTable = pgTable(
  "assessment_share_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => assessmentSubmissionsTable.id, { onDelete: "cascade" }),
    // sha256 hex of the opaque token. Unique so a presented token resolves to at
    // most one share. The token itself never lands in a column.
    tokenHash: text("token_hash").notNull().unique(),
    // Every link expires. Enforced at read time, not just displayed.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set when a link is revoked early; a revoked link reads as gone.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Real access telemetry, updated on every successful public read. Never a
    // fabricated figure: a link that has not been opened shows null and 0.
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    submissionIdx: index("assessment_share_tokens_submission_idx").on(t.submissionId),
  }),
);

export type AssessmentShareToken = typeof assessmentShareTokensTable.$inferSelect;
export type InsertAssessmentShareToken = typeof assessmentShareTokensTable.$inferInsert;
