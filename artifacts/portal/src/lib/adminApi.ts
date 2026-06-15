import type { AdminUser, Org, Pin, Tenant } from "../types";

// The Access console data layer. Same shape as authApi: framework-free helpers
// that own the real logic (401 detection so the caller can log out, list-state
// derivation, and error-code extraction) so they can be unit tested with a
// mocked fetch and no DOM. A 401 surfaces as { unauthorized: true } rather than
// calling logout directly, keeping these functions pure and the components thin.

export type ListOutcome<T> =
  | { unauthorized: true }
  | { state: "ready" | "empty"; items: T[] }
  | { state: "error" };

export type WriteOutcome =
  | { unauthorized: true }
  | { ok: true }
  | { error: string };

export type MintOutcome =
  | { unauthorized: true }
  | { code: string }
  | { error: string };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || "failed";
}

async function getList<T>(url: string, field: string): Promise<ListOutcome<T>> {
  try {
    const res = await fetch(url);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const items = ((data as Record<string, unknown>)[field] ?? []) as T[];
    return { state: items.length > 0 ? "ready" : "empty", items };
  } catch {
    return { state: "error" };
  }
}

export const fetchOrgs = () => getList<Org>("/api/admin/orgs", "orgs");
export const fetchPins = () => getList<Pin>("/api/admin/pins", "pins");
export const fetchUsers = () => getList<AdminUser>("/api/admin/users", "users");
export const fetchTenants = () => getList<Tenant>("/api/admin/tenants", "tenants");

export async function mintPin(payload: {
  label: string;
  maxUses: number;
  expiresInDays: number;
  scopeRole: string;
  scopeOrgId?: string;
}): Promise<MintOutcome> {
  try {
    const res = await fetch("/api/admin/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = await res.json();
    return { code: data.pin.code as string };
  } catch {
    return { error: "failed" };
  }
}

export async function revokePin(id: string): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/admin/pins/${id}/revoke`, { method: "POST" });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: "failed" };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

export async function setUserStatus(id: string, action: "enable" | "disable"): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/admin/users/${id}/${action}`, { method: "POST" });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

export async function createOrg(input: { name: string; type: "client" | "portfolio" }): Promise<WriteOutcome> {
  try {
    const res = await fetch("/api/admin/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: "failed" };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

export async function bindTenant(orgId: string, tenantId: string): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/admin/orgs/${orgId}/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

// ── Phase AG: curated custom-layer console (owner-only) ──

// A custom layer as the owner console lists it (GET /layers/custom). The server
// returns the full catalog projection plus the approval lifecycle and benchmark
// mapping; the panel reads this subset.
export interface CustomLayer {
  key: string;
  name: string;
  archetype: string;
  isCanonical: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  benchmarkCanonicalKey: string | null;
  createdAt: string;
  diagnosticQuestion: string;
  moduleGroup: string;
}

// The runnable catalog projection (GET /layers). The console reads it only to
// derive the canonical keys (catalog minus custom) for the benchmark mapping.
export interface CatalogLayer {
  key: string;
  name: string;
  archetype: string;
}

// The guarded creation template the panel submits. Mirrors the server's
// customLayerTemplateSchema high-signal fields; the server fills honest defaults
// for everything else and creates the layer UNAPPROVED.
export interface CustomLayerInput {
  name: string;
  diagnosticQuestion: string;
  archetype: string;
  metricDefinitions: { tiles: string[] };
  feeds: string[];
  benchmarkCanonicalKey?: string;
}

export const fetchCustomLayers = () => getList<CustomLayer>("/api/layers/custom", "layers");
export const fetchCatalogLayers = () => getList<CatalogLayer>("/api/layers", "layers");

export async function createCustomLayer(input: CustomLayerInput): Promise<WriteOutcome> {
  try {
    const res = await fetch("/api/layers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

export async function approveCustomLayer(key: string): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/layers/${encodeURIComponent(key)}/approve`, { method: "POST" });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}
