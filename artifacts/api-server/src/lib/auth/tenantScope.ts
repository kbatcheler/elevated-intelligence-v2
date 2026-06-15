import { eq, inArray } from "drizzle-orm";
import { db, orgTenantsTable, tenantsTable, usersTable } from "@workspace/db";
import { isProvider } from "./access";

// The db-backed companion to the pure access predicate in access.ts. It resolves
// the full set of tenant ids a seat may reach, the same posture requireTenantAccess
// enforces per request: a provider seat reaches every tenant; a client or
// portfolio seat reaches only the tenants its org is bound to through org_tenants;
// a seat with no org reaches nothing. The push surface fences every read and
// write by this set, so a user only ever touches notifications and rules for
// tenants they can actually see.
export async function resolveAccessibleTenantIds(user: {
  role: Parameters<typeof isProvider>[0];
  orgId: string | null;
}): Promise<string[]> {
  if (isProvider(user.role)) {
    const all = await db.select({ id: tenantsTable.id }).from(tenantsTable);
    return all.map((t) => t.id);
  }
  if (!user.orgId) return [];
  const bindings = await db
    .select({ tenantId: orgTenantsTable.tenantId })
    .from(orgTenantsTable)
    .where(eq(orgTenantsTable.orgId, user.orgId));
  return bindings.map((b) => b.tenantId);
}

// The stable key for a single (user, tenant) reachability fact. A null byte
// joiner can never appear inside a uuid, so the two ids can never collide.
export function accessPairKey(userId: string, tenantId: string): string {
  return userId + "\u0000" + tenantId;
}

// Batch companion to resolveAccessibleTenantIds. Given a set of user ids, it
// returns the set of (user, tenant) pairs those users can CURRENTLY reach, keyed
// by accessPairKey. The scheduled push drainer uses it to re-verify access at
// delivery time: a notification that went pending for a tenant a user no longer
// reaches (its org_tenants binding was removed after the event was recorded)
// must be failed, never delivered to an external channel after access was
// revoked. Only active users are reachable; an inactive seat resolves to no
// pairs, so its stale pending events fail rather than leak.
export async function resolveAccessiblePairsForUsers(
  userIds: readonly string[],
): Promise<Set<string>> {
  const pairs = new Set<string>();
  if (userIds.length === 0) return pairs;

  const users = await db
    .select({ id: usersTable.id, role: usersTable.role, orgId: usersTable.orgId, status: usersTable.status })
    .from(usersTable)
    .where(inArray(usersTable.id, [...userIds]));

  const providerIds: string[] = [];
  const usersByOrg = new Map<string, string[]>();
  for (const u of users) {
    if (u.status !== "active") continue;
    if (isProvider(u.role)) {
      providerIds.push(u.id);
    } else if (u.orgId) {
      const list = usersByOrg.get(u.orgId) ?? [];
      list.push(u.id);
      usersByOrg.set(u.orgId, list);
    }
  }

  if (providerIds.length > 0) {
    const allTenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);
    for (const uid of providerIds) {
      for (const t of allTenants) pairs.add(accessPairKey(uid, t.id));
    }
  }

  const orgIds = [...usersByOrg.keys()];
  if (orgIds.length > 0) {
    const bindings = await db
      .select({ orgId: orgTenantsTable.orgId, tenantId: orgTenantsTable.tenantId })
      .from(orgTenantsTable)
      .where(inArray(orgTenantsTable.orgId, orgIds));
    const tenantsByOrg = new Map<string, string[]>();
    for (const b of bindings) {
      const list = tenantsByOrg.get(b.orgId) ?? [];
      list.push(b.tenantId);
      tenantsByOrg.set(b.orgId, list);
    }
    for (const [orgId, uids] of usersByOrg) {
      const tenants = tenantsByOrg.get(orgId) ?? [];
      for (const uid of uids) {
        for (const tid of tenants) pairs.add(accessPairKey(uid, tid));
      }
    }
  }

  return pairs;
}
