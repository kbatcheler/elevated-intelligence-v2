// Sellability Pack (Phase AB): the data layer for read-only, shareable diagnosis
// links. The opaque token is generated here, returned to the minter exactly ONCE,
// and never persisted; only its sha256 hash is stored, so a database read can
// never reconstruct a working link. Resolution hashes the presented token, loads
// the one unexpired, unrevoked row, records real access telemetry, and returns
// only the tenant id and privacy posture, never a user identity.

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  diagnosisShareTokensTable,
  type DiagnosisSharePrivacy,
} from "@workspace/db";

// 32 bytes of CSPRNG entropy, base64url so the token is URL-safe with no padding.
const TOKEN_BYTES = 32;
const DEFAULT_EXPIRES_DAYS = 30;
const MIN_EXPIRES_DAYS = 1;
const MAX_EXPIRES_DAYS = 365;

// sha256 hex of the opaque token. The only form that ever touches a column.
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Clamp a requested lifetime into the supported band. An absent or non-finite
// value takes the default; a link is never "forever" and never sub-day.
export function clampExpiresInDays(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_EXPIRES_DAYS;
  const n = Math.floor(raw);
  if (n < MIN_EXPIRES_DAYS) return MIN_EXPIRES_DAYS;
  if (n > MAX_EXPIRES_DAYS) return MAX_EXPIRES_DAYS;
  return n;
}

// The status of a share at a point in time, derived from its real columns: a
// revoked link reads revoked, an elapsed expiry reads expired, otherwise active.
export type ShareTokenStatus = "active" | "expired" | "revoked";

export function shareTokenStatus(
  row: { revokedAt: Date | null; expiresAt: Date },
  now: Date,
): ShareTokenStatus {
  if (row.revokedAt != null) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export interface ShareTokenMetadata {
  id: string;
  privacyLevel: DiagnosisSharePrivacy;
  label: string | null;
  status: ShareTokenStatus;
  expiresAt: Date;
  revokedAt: Date | null;
  lastAccessedAt: Date | null;
  accessCount: number;
  createdAt: Date;
}

export interface MintedShareToken extends ShareTokenMetadata {
  // The plaintext token, returned ONLY from mint and never readable again.
  token: string;
  // The portal path that renders the link. Relative, so the caller composes the
  // absolute URL from its own origin (the API never knows the portal origin).
  diagnosisPath: string;
}

// Mint a new share for a tenant. The token is generated, hashed, and only the
// hash is stored; the plaintext is returned once for the operator to copy.
export async function mintShareToken(opts: {
  tenantId: string;
  createdBy: string | null;
  label?: string | null;
  expiresInDays?: number | null;
  now?: Date;
}): Promise<MintedShareToken> {
  const now = opts.now ?? new Date();
  const days = clampExpiresInDays(opts.expiresInDays);
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashShareToken(token);

  const inserted = await db
    .insert(diagnosisShareTokensTable)
    .values({
      tenantId: opts.tenantId,
      tokenHash,
      privacyLevel: "summary_only",
      createdBy: opts.createdBy,
      label: opts.label ?? null,
      expiresAt,
      createdAt: now,
    })
    .returning({
      id: diagnosisShareTokensTable.id,
      privacyLevel: diagnosisShareTokensTable.privacyLevel,
      label: diagnosisShareTokensTable.label,
      expiresAt: diagnosisShareTokensTable.expiresAt,
      revokedAt: diagnosisShareTokensTable.revokedAt,
      lastAccessedAt: diagnosisShareTokensTable.lastAccessedAt,
      accessCount: diagnosisShareTokensTable.accessCount,
      createdAt: diagnosisShareTokensTable.createdAt,
    });

  const row = inserted[0]!;
  return {
    id: row.id,
    privacyLevel: row.privacyLevel,
    label: row.label,
    status: shareTokenStatus(row, now),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastAccessedAt: row.lastAccessedAt,
    accessCount: row.accessCount,
    createdAt: row.createdAt,
    token,
    diagnosisPath: "/d/" + token,
  };
}

// List a tenant's shares as metadata only: never the token and never the hash.
// Newest first, each with its derived status.
export async function listShareTokens(
  tenantId: string,
  now: Date = new Date(),
): Promise<ShareTokenMetadata[]> {
  const rows = await db
    .select({
      id: diagnosisShareTokensTable.id,
      privacyLevel: diagnosisShareTokensTable.privacyLevel,
      label: diagnosisShareTokensTable.label,
      expiresAt: diagnosisShareTokensTable.expiresAt,
      revokedAt: diagnosisShareTokensTable.revokedAt,
      lastAccessedAt: diagnosisShareTokensTable.lastAccessedAt,
      accessCount: diagnosisShareTokensTable.accessCount,
      createdAt: diagnosisShareTokensTable.createdAt,
    })
    .from(diagnosisShareTokensTable)
    .where(eq(diagnosisShareTokensTable.tenantId, tenantId))
    .orderBy(desc(diagnosisShareTokensTable.createdAt));

  return rows.map((r) => ({ ...r, status: shareTokenStatus(r, now) }));
}

export interface RevokeResult {
  id: string;
  revokedAt: Date;
  alreadyRevoked: boolean;
}

// Revoke a share early. Idempotent: revoking an already-revoked link succeeds and
// reports alreadyRevoked, never moving the original revocation time. Returns null
// when the id is not a share of this tenant (the route maps that to a 404).
export async function revokeShareToken(
  tenantId: string,
  tokenId: string,
  now: Date = new Date(),
): Promise<RevokeResult | null> {
  const existing = await db
    .select({
      id: diagnosisShareTokensTable.id,
      revokedAt: diagnosisShareTokensTable.revokedAt,
    })
    .from(diagnosisShareTokensTable)
    .where(
      and(
        eq(diagnosisShareTokensTable.id, tokenId),
        eq(diagnosisShareTokensTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (!row) return null;
  if (row.revokedAt != null) {
    return { id: row.id, revokedAt: row.revokedAt, alreadyRevoked: true };
  }

  const updated = await db
    .update(diagnosisShareTokensTable)
    .set({ revokedAt: now })
    .where(eq(diagnosisShareTokensTable.id, tokenId))
    .returning({ revokedAt: diagnosisShareTokensTable.revokedAt });

  return { id: tokenId, revokedAt: updated[0]!.revokedAt!, alreadyRevoked: false };
}

export interface ResolvedShare {
  tenantId: string;
  privacyLevel: DiagnosisSharePrivacy;
}

// Resolve a presented token to its tenant and privacy posture, or null when no
// unexpired, unrevoked row matches. On a hit it records real access telemetry
// (count and last-accessed) before returning. A non-match (expired, revoked, or
// unknown) is indistinguishable to the caller, which keeps the public 404 uniform.
export async function resolveShareToken(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedShare | null> {
  if (token.length === 0) return null;
  const tokenHash = hashShareToken(token);
  const rows = await db
    .select({
      id: diagnosisShareTokensTable.id,
      tenantId: diagnosisShareTokensTable.tenantId,
      privacyLevel: diagnosisShareTokensTable.privacyLevel,
    })
    .from(diagnosisShareTokensTable)
    .where(
      and(
        eq(diagnosisShareTokensTable.tokenHash, tokenHash),
        isNull(diagnosisShareTokensTable.revokedAt),
        gt(diagnosisShareTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db
    .update(diagnosisShareTokensTable)
    .set({
      accessCount: sql`${diagnosisShareTokensTable.accessCount} + 1`,
      lastAccessedAt: now,
    })
    .where(eq(diagnosisShareTokensTable.id, row.id));

  return { tenantId: row.tenantId, privacyLevel: row.privacyLevel };
}
