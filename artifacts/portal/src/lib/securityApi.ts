import type {
  AccessEvent,
  ConnectorHealthReport,
  Grant,
  HumanSignal,
  KeyStatus,
  VerifyResult,
} from "../types";
import type { ListOutcome, WriteOutcome } from "./adminApi";

// The Tier 3 security data layer (Phase L over the Phase K backend). Same shape
// discipline as adminApi: framework-free helpers that own the real logic (401
// detection so the caller can log out, list-state derivation, and honest mapping
// of the typed crypto and break-glass failures) so they can be unit tested with a
// mocked fetch and no DOM. A 401 surfaces as { unauthorized: true } rather than
// calling logout directly, keeping these functions pure and the components thin.

// A single record read (key status, provenance verify). Distinct from a list so
// the component can tell a real payload from a transient error.
export type ReadOutcome<T> =
  | { unauthorized: true }
  | { ok: true; data: T }
  | { error: string };

// The human signal read maps the backend's three honest failure codes onto
// explicit states, never collapsing a denied or shredded read into an empty list.
export type SignalsOutcome =
  | { unauthorized: true }
  | { state: "ready" | "empty"; signals: HumanSignal[] }
  | { state: "break_glass_required"; detail: string | null }
  | { state: "crypto_shredded"; detail: string | null }
  | { state: "signal_unreadable"; detail: string | null }
  | { state: "error" };

async function readBody(res: Response): Promise<{ error?: string; detail?: string }> {
  return (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
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

async function post(url: string, body?: unknown): Promise<WriteOutcome> {
  try {
    const init: RequestInit = { method: "POST" };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: (await readBody(res)).error || "failed" };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

// -- Tenant key lifecycle (owner) ---------------------------------------------

export async function fetchKeyStatus(tenantId: string): Promise<ReadOutcome<KeyStatus>> {
  try {
    const res = await fetch(`/api/security/tenants/${tenantId}/key`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: (await readBody(res)).error || "failed" };
    return { ok: true, data: (await res.json()) as KeyStatus };
  } catch {
    return { error: "failed" };
  }
}

export const provisionTenantKey = (tenantId: string): Promise<WriteOutcome> =>
  post(`/api/security/tenants/${tenantId}/key/provision`);

export const revokeTenantKey = (tenantId: string): Promise<WriteOutcome> =>
  post(`/api/security/tenants/${tenantId}/key/revoke`);

// -- Break-glass grant administration (owner) ---------------------------------

export const fetchGrants = (tenantId: string): Promise<ListOutcome<Grant>> =>
  getList<Grant>(`/api/security/tenants/${tenantId}/grants`, "grants");

export const createGrant = (
  tenantId: string,
  input: { userId: string; reason: string; expiresInMinutes: number },
): Promise<WriteOutcome> => post(`/api/security/tenants/${tenantId}/grants`, input);

export const revokeGrant = (grantId: string): Promise<WriteOutcome> =>
  post(`/api/security/grants/${grantId}/revoke`);

export const fetchAccessEvents = (tenantId: string): Promise<ListOutcome<AccessEvent>> =>
  getList<AccessEvent>(`/api/security/tenants/${tenantId}/access-events`, "events");

// -- Provenance verification (owner) ------------------------------------------

export async function verifyProvenance(tenantId: string): Promise<ReadOutcome<VerifyResult>> {
  try {
    const res = await fetch(`/api/security/tenants/${tenantId}/provenance/verify`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: (await readBody(res)).error || "failed" };
    return { ok: true, data: (await res.json()) as VerifyResult };
  } catch {
    return { error: "failed" };
  }
}

// -- Break-glass human signal read (any role, active grant required) -----------

export async function fetchHumanSignals(tenantId: string): Promise<SignalsOutcome> {
  try {
    const res = await fetch(`/api/security/tenants/${tenantId}/signals`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) {
      const body = await readBody(res);
      if (body.error === "break_glass_required") {
        return { state: "break_glass_required", detail: body.detail ?? null };
      }
      if (body.error === "crypto_shredded") {
        return { state: "crypto_shredded", detail: body.detail ?? null };
      }
      if (body.error === "signal_unreadable") {
        return { state: "signal_unreadable", detail: body.detail ?? null };
      }
      return { state: "error" };
    }
    const data = await res.json();
    const signals = ((data as Record<string, unknown>).signals ?? []) as HumanSignal[];
    return { state: signals.length > 0 ? "ready" : "empty", signals };
  } catch {
    return { state: "error" };
  }
}

// -- Connector health (owner, Phase O) ----------------------------------------

export async function fetchConnectorHealth(
  tenantId: string,
): Promise<ReadOutcome<ConnectorHealthReport>> {
  try {
    const res = await fetch(`/api/security/tenants/${tenantId}/connector-health`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: (await readBody(res)).error || "failed" };
    return { ok: true, data: (await res.json()) as ConnectorHealthReport };
  } catch {
    return { error: "failed" };
  }
}
