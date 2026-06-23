import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assessmentShareTokensTable,
  assessmentSubmissionsTable,
  db,
  type AssessmentDimensionScores,
} from "@workspace/db";
import {
  hashAssessmentToken,
  mintAssessmentToken,
  resolveAssessmentToken,
} from "./shareTokens";

// The forwardable link data layer against a real Postgres: the plaintext token
// is never stored (only its hash), a presented token resolves to its submission
// and records real access telemetry, and an expired, revoked or unknown token is
// indistinguishable null.

const RUN = "assesstok-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
let submissionId = "";

const dimensionScores: AssessmentDimensionScores = {
  dimensions: [{ key: "visibility", score: 0, band: "blind" }],
  overall: { score: 0, band: "blind" },
};

beforeAll(async () => {
  const [row] = await db
    .insert(assessmentSubmissionsTable)
    .values({
      answers: { visibility_attribution: "blind" },
      dimensionScores,
      qualification: { sector: "technology", revenueBand: "5m_20m", systems: [] },
      contactEmail: RUN + "@example.com",
    })
    .returning({ id: assessmentSubmissionsTable.id });
  submissionId = row!.id;
});

afterAll(async () => {
  // Deleting the submission cascades to its share tokens.
  if (submissionId) {
    await db.delete(assessmentSubmissionsTable).where(eq(assessmentSubmissionsTable.id, submissionId));
  }
});

describe("mintAssessmentToken", () => {
  it("returns a plaintext token and a /a/ path, persisting only the hash", async () => {
    const minted = await mintAssessmentToken({ submissionId });
    expect(minted.token.length).toBeGreaterThan(0);
    expect(minted.reportPath).toBe("/a/" + minted.token);

    const stored = await db
      .select({
        tokenHash: assessmentShareTokensTable.tokenHash,
        submissionId: assessmentShareTokensTable.submissionId,
      })
      .from(assessmentShareTokensTable)
      .where(eq(assessmentShareTokensTable.id, minted.id));
    expect(stored[0]!.tokenHash).toBe(hashAssessmentToken(minted.token));
    expect(stored[0]!.tokenHash).not.toBe(minted.token);
    expect(stored[0]!.submissionId).toBe(submissionId);
  });
});

describe("resolveAssessmentToken", () => {
  it("resolves a live token to its submission and records access telemetry", async () => {
    const minted = await mintAssessmentToken({ submissionId });
    const resolved = await resolveAssessmentToken(minted.token);
    expect(resolved?.submissionId).toBe(submissionId);

    const row = await db
      .select({
        accessCount: assessmentShareTokensTable.accessCount,
        lastAccessedAt: assessmentShareTokensTable.lastAccessedAt,
      })
      .from(assessmentShareTokensTable)
      .where(eq(assessmentShareTokensTable.id, minted.id));
    expect(row[0]!.accessCount).toBe(1);
    expect(row[0]!.lastAccessedAt).not.toBeNull();
  });

  it("returns null for an unknown token", async () => {
    expect(await resolveAssessmentToken("not-a-real-token")).toBeNull();
    expect(await resolveAssessmentToken("")).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const past = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const minted = await mintAssessmentToken({ submissionId, now: past });
    expect(await resolveAssessmentToken(minted.token)).toBeNull();
  });

  it("returns null for a revoked token", async () => {
    const minted = await mintAssessmentToken({ submissionId });
    await db
      .update(assessmentShareTokensTable)
      .set({ revokedAt: new Date() })
      .where(eq(assessmentShareTokensTable.id, minted.id));
    expect(await resolveAssessmentToken(minted.token)).toBeNull();
  });
});
