export type UserRole = "provider-owner" | "provider-member" | "client-admin" | "client-viewer";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  orgId: string | null;
}

export interface Pin {
  id: string;
  code?: string; // only on create
  label: string | null;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  revokedAt: string | null;
  scopeOrgId: string | null;
  scopeRole: string | null;
  createdAt: string;
  state: "active" | "expired" | "revoked" | "used-up";
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: "active" | "disabled";
  orgId: string | null;
  orgName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  url: string;
  status: string;
}

export interface Org {
  id: string;
  name: string;
  type: "provider" | "client" | "portfolio";
  createdAt: string;
  tenants: { id: string; name: string }[];
}
