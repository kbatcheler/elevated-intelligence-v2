import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  accessGrantEventsTable,
  accessGrantsTable,
  db,
  type AccessGrant,
  type AccessGrantEvent,
} from "@workspace/db";
import { BreakGlassRequiredError } from "./errors";

// Break-glass: there is no standing human access to a connected tenant's raw
// signal values. A read is allowed only under an active, owner-approved, time-
// boxed grant, and every read is logged. This rule binds EVERY role, the owner
// included: holding the owner seat does not by itself open a tenant's raw data.
// The pipeline's machine grounding read is a SEPARATE service path and is exempt
// by construction (it never calls through here), so de-identified math can ground
// the model without a human ever standing in the data.

export interface CreateGrantInput {
  userId: string;
  tenantId: string;
  grantedBy: string;
  reason: string;
  expiresInMinutes: number;
}

// Owner approves a time-boxed grant for a user and tenant with a recorded reason.
export async function createBreakGlassGrant(input: CreateGrantInput): Promise<AccessGrant> {
  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60 * 1000);
  const inserted = await db
    .insert(accessGrantsTable)
    .values({
      userId: input.userId,
      tenantId: input.tenantId,
      grantedBy: input.grantedBy,
      reason: input.reason,
      expiresAt,
    })
    .returning();
  return inserted[0]!;
}

// Revoke a grant before it expires. Idempotent: revoking an already-revoked or
// absent grant simply reports that nothing active was revoked.
export async function revokeBreakGlassGrant(
  grantId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(accessGrantsTable)
    .set({ revokedAt: now })
    .where(and(eq(accessGrantsTable.id, grantId), isNull(accessGrantsTable.revokedAt)))
    .returning({ id: accessGrantsTable.id });
  return updated.length > 0;
}

// The standing-access denial. Returns the active grant or throws
// BreakGlassRequiredError. Active means: belongs to this user and tenant, not
// revoked, and not yet expired. No role is exempt.
export async function requireActiveBreakGlassGrant(
  userId: string,
  tenantId: string,
  now: Date = new Date(),
): Promise<AccessGrant> {
  const rows = await db
    .select()
    .from(accessGrantsTable)
    .where(
      and(
        eq(accessGrantsTable.userId, userId),
        eq(accessGrantsTable.tenantId, tenantId),
        isNull(accessGrantsTable.revokedAt),
        gt(accessGrantsTable.expiresAt, now),
      ),
    )
    .orderBy(desc(accessGrantsTable.grantedAt))
    .limit(1);
  const grant = rows[0];
  if (!grant) {
    throw new BreakGlassRequiredError(
      tenantId,
      "no active break-glass grant for this user and tenant",
    );
  }
  return grant;
}

// Append one audit event for a single access under a grant. Insert only.
export async function logSignalAccess(
  grantId: string,
  userId: string,
  tenantId: string,
  action: string,
  detail?: string,
): Promise<AccessGrantEvent> {
  const inserted = await db
    .insert(accessGrantEventsTable)
    .values({ grantId, userId, tenantId, action, detail: detail ?? null })
    .returning();
  return inserted[0]!;
}

// List the access events for a tenant, newest first. Read side for the audit.
export async function listAccessEvents(
  tenantId: string,
  limit = 200,
): Promise<AccessGrantEvent[]> {
  return db
    .select()
    .from(accessGrantEventsTable)
    .where(eq(accessGrantEventsTable.tenantId, tenantId))
    .orderBy(desc(accessGrantEventsTable.createdAt))
    .limit(limit);
}

// List the grants for a tenant, newest first, for the owner's management view.
export async function listGrants(tenantId: string, limit = 200): Promise<AccessGrant[]> {
  return db
    .select()
    .from(accessGrantsTable)
    .where(eq(accessGrantsTable.tenantId, tenantId))
    .orderBy(desc(accessGrantsTable.grantedAt))
    .limit(limit);
}
