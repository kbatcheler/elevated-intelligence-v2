import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// The Intelligence Gap Assessment (Phase AT). A pre-auth, top-of-funnel self
// assessment. One row per completed assessment: the prospect's own scored
// answers, the deterministically computed four-dimension scores, the
// qualification answers, an optional captured contact, and an OPTIONAL
// outside_in profile-grade diagnosis snapshot.
//
// Honesty boundaries that shape this schema:
// - The on-screen result is computed and shown free; contact is captured ONLY
//   to unlock the forwardable and downloadable report, so the contact columns
//   are nullable and a row is valid before they are set.
// - The optional diagnosis NEVER creates a tenant and NEVER stores raw homepage
//   HTML or a model snippet: only a narrow profile projection plus fetch
//   telemetry. Its lifecycle is a small explicit status machine, so an
//   in-progress or unavailable taste reads honestly rather than as a fabricated
//   figure. The status enum is the source of truth; the jsonb holds the detail.

// The lifecycle of the optional outside_in taste. not_requested when no company
// url was supplied; pending the instant a diagnosis is queued at contact
// capture; in_progress while the fetch and profile run; ready on a grounded
// profile; unavailable when the public footprint is too thin to ground a claim
// (a failed or empty homepage fetch, or a budget ceiling) so it degrades to the
// self assessment alone; failed when a billed model call did not return a valid
// profile.
export const assessmentDiagnosisStatusEnum = pgEnum("assessment_diagnosis_status", [
  "not_requested",
  "pending",
  "in_progress",
  "ready",
  "unavailable",
  "failed",
]);

export type AssessmentDiagnosisStatus =
  (typeof assessmentDiagnosisStatusEnum.enumValues)[number];

// The prospect's scored answers, keyed by stable question id to the chosen
// option key. Validated against the question bank on read; never trusted raw.
export type AssessmentAnswers = Record<string, string>;

// The qualification answers, which route and qualify the lead but never score
// the gap. systems is the set of core platforms the prospect runs.
export interface AssessmentQualification {
  sector: string;
  revenueBand: string;
  systems: string[];
}

// The computed four-dimension shape, persisted so the forwardable report renders
// byte-identical to the on-screen result with no recomputation drift. Scores are
// 0..100, derived from the prospect's own answers, never rigged.
export interface AssessmentDimensionScore {
  key: string;
  score: number;
  band: "blind" | "reactive" | "ahead";
}

export interface AssessmentDimensionScores {
  dimensions: AssessmentDimensionScore[];
  overall: { score: number; band: "blind" | "reactive" | "ahead" };
}

// The optional outside_in diagnosis snapshot. The top-level diagnosisStatus
// column is the authoritative status; this jsonb holds only the detail. It NEVER
// holds raw HTML or a model snippet: a narrow profile projection plus honest
// fetch and billing telemetry, so reflection and proof can sit on one page
// without a fabricated number.
export interface AssessmentDiagnosisSnapshot {
  requestedAt: string;
  completedAt: string | null;
  url: string;
  domain: string;
  finalUrl: string;
  homepage: {
    ok: boolean;
    status: number;
    bytesFetched: number;
    bytesExtracted: number;
    durationMs: number;
  };
  profile: {
    name: string;
    sector: string | null;
    tagline: string | null;
    url: string | null;
  } | null;
  provenance: "verified" | "modelled" | "unavailable";
  telemetry: {
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    billed: boolean;
  } | null;
}

export const assessmentSubmissionsTable = pgTable(
  "assessment_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The raw scored answers, validated against the question bank on read.
    answers: jsonb("answers").$type<AssessmentAnswers>().notNull(),
    // The computed four-dimension scores, persisted for render stability.
    dimensionScores: jsonb("dimension_scores").$type<AssessmentDimensionScores>().notNull(),
    // The qualification answers (sector, revenue band, core systems).
    qualification: jsonb("qualification").$type<AssessmentQualification>().notNull(),
    // The optional company url the prospect supplied. Null when none. Cleaned but
    // never trusted: the diagnosis runner re-validates it through the SSRF gate.
    companyUrl: text("company_url"),
    // The optional outside_in taste. Status is the source of truth; the snapshot
    // jsonb is null until there is detail to record.
    diagnosisStatus: assessmentDiagnosisStatusEnum("diagnosis_status")
      .notNull()
      .default("not_requested"),
    diagnosis: jsonb("diagnosis").$type<AssessmentDiagnosisSnapshot>(),
    // Contact captured in the second step to unlock the report. Null until
    // capture; the on-screen result is shown free before any of these are set.
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactCompany: text("contact_company"),
    contactCapturedAt: timestamp("contact_captured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("assessment_submissions_created_idx").on(t.createdAt),
  }),
);

export type AssessmentSubmission = typeof assessmentSubmissionsTable.$inferSelect;
export type InsertAssessmentSubmission = typeof assessmentSubmissionsTable.$inferInsert;
