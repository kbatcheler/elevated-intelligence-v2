import type { UserRole } from "@workspace/db";

// The single, pure access model for the platform. Provider seats run Different
// Day and see every tenant by role. Client and portfolio seats see only the
// tenants their org is bound to through org_tenants. Keeping this a pure
// predicate over already-loaded inputs makes it trivial to test exhaustively
// and impossible to accidentally couple to a request object.

export function isProvider(role: UserRole): boolean {
  return role === "provider-owner" || role === "provider-member";
}

export function isOwner(role: UserRole): boolean {
  return role === "provider-owner";
}

export function canAccessTenant(
  user: { role: UserRole; orgId: string | null },
  tenantId: string,
  boundTenantIds: ReadonlySet<string>,
): boolean {
  if (isProvider(user.role)) return true;
  if (!user.orgId) return false;
  return boundTenantIds.has(tenantId);
}
