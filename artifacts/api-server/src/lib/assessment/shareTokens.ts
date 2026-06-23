// The Intelligence Gap Assessment forwardable link (Phase AT). Mirrors the
// Sellability share token data layer exactly: the opaque token is generated
// here, returned to the minter exactly ONCE and never persisted, only its
// sha256 hash is stored, and resolution hashes the presented token, loads the
// one unexpired, unrevoked row, records real access telemetry, and returns only
// the submission id. The link is anonymous: it references a submission, not a
// tenant, and there is no minting user identity to record.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { assessmentShareTokensTable, db } from "@workspace/db";

const TOKEN_BYTES = 32;
const DEFAULT_EXPIRES_DAYS = 30;
const MIN_EXPIRES_DAYS = 1;
const MAX_EXPIRES_DAYS = 365;

// sha256 hex of the opaque token. The only form that ever touches a column.
export function hashAssessmentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function clampExpiresInDays(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_EXPIRES_DAYS;
  const n = Math.floor(raw);
  if (n < MIN_EXPIRES_DAYS) return MIN_EXPIRES_DAYS;
  if (n > MAX_EXPIRES_DAYS) return MAX_EXPIRES_DAYS;
  return n;
}

export interface MintedAssessmentToken {
  id: string;
  token: string;
  // Relative portal path that renders the forwardable report. The caller
  // composes the absolute URL from its own origin.
  reportPath: string;
  expiresAt: Date;
  createdAt: Date;
}

// Mint a forwardable link for a submission. The token is generated, hashed, and
// only the hash is stored; the plaintext is returned once to embed in the link.
export async function mintAssessmentToken(opts: {
  submissionId: string;
  expiresInDays?: number | null;
  now?: Date;
}): Promise<MintedAssessmentToken> {
  const now = opts.now ?? new Date();
  const days = clampExpiresInDays(opts.expiresInDays);
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashAssessmentToken(token);

  const inserted = await db
    .insert(assessmentShareTokensTable)
    .values({ submissionId: opts.submissionId, tokenHash, expiresAt, createdAt: now })
    .returning({
      id: assessmentShareTokensTable.id,
      expiresAt: assessmentShareTokensTable.expiresAt,
      createdAt: assessmentShareTokensTable.createdAt,
    });

  const row = inserted[0]!;
  return {
    id: row.id,
    token,
    reportPath: "/a/" + token,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

// Resolve a presented token to its submission id, or null when no unexpired,
// unrevoked row matches. On a hit it records real access telemetry before
// returning. A non-match (expired, revoked or unknown) is indistinguishable to
// the caller, keeping the public 404 uniform.
export async function resolveAssessmentToken(
  token: string,
  now: Date = new Date(),
): Promise<{ submissionId: string } | null> {
  if (token.length === 0) return null;
  const tokenHash = hashAssessmentToken(token);
  const rows = await db
    .select({
      id: assessmentShareTokensTable.id,
      submissionId: assessmentShareTokensTable.submissionId,
    })
    .from(assessmentShareTokensTable)
    .where(
      and(
        eq(assessmentShareTokensTable.tokenHash, tokenHash),
        isNull(assessmentShareTokensTable.revokedAt),
        gt(assessmentShareTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db
    .update(assessmentShareTokensTable)
    .set({
      accessCount: sql`${assessmentShareTokensTable.accessCount} + 1`,
      lastAccessedAt: now,
    })
    .where(eq(assessmentShareTokensTable.id, row.id));

  return { submissionId: row.submissionId };
}
