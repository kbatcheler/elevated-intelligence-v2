import type {
  Architecture,
  BenchmarkConsentState,
  CommittedAction,
  LayerRegistryEntry,
  OverviewLayer,
  PipelineRun,
  SignalLayer,
  TenantLayerDetail,
  TenantProfile,
  TenantSummary,
} from "../types";

// The intelligence data layer. Same contract as adminApi: framework-free
// helpers that own the real logic (401 detection so the caller can log out,
// list-state derivation, error-code extraction) and return discriminated
// outcomes, so they can be unit-tested with a mocked fetch and no DOM. A 401
// surfaces as { unauthorized: true } rather than logging out directly, keeping
// these functions pure and the components thin.

export type ListOutcome<T> =
  | { unauthorized: true }
  | { state: "ready" | "empty"; items: T[] }
  | { state: "error" };

export type DetailOutcome<T> =
  | { unauthorized: true }
  | { state: "ready"; data: T }
  | { state: "empty" }
  | { state: "error" };

export type WriteOutcome =
  | { unauthorized: true }
  | { ok: true }
  | { error: string };

export type CommitOutcome =
  | { unauthorized: true }
  | { ok: true; action: CommittedAction }
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

async function getDetail<T>(url: string): Promise<DetailOutcome<T>> {
  try {
    const res = await fetch(url);
    if (res.status === 401) return { unauthorized: true };
    if (res.status === 404) return { state: "empty" };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as T;
    return { state: "ready", data };
  } catch {
    return { state: "error" };
  }
}

export const fetchTenants = () => getList<TenantSummary>("/api/tenants", "tenants");
export const fetchLayers = () => getList<LayerRegistryEntry>("/api/layers", "layers");
export const fetchOverview = (tenantId: string) =>
  getList<OverviewLayer>(`/api/tenants/${tenantId}/overview`, "overview");
export const fetchRuns = (tenantId: string) =>
  getList<PipelineRun>(`/api/tenants/${tenantId}/runs`, "runs");
export const fetchActions = (tenantId: string) =>
  getList<CommittedAction>(`/api/tenants/${tenantId}/actions`, "actions");
export const fetchSignals = (tenantId: string) =>
  getList<SignalLayer>(`/api/tenants/${tenantId}/signals`, "signals");

// The intelligence architecture is engine config, not tenant data, so it is a
// single object (seats + ordered stages) rather than a list.
export const fetchArchitecture = () => getDetail<Architecture>("/api/architecture");

export const fetchTenantLayer = (tenantId: string, key: string) =>
  getDetail<TenantLayerDetail>(`/api/tenants/${tenantId}/layers/${key}`);

export const fetchTenant = (tenantId: string) =>
  getDetail<{ tenant: TenantSummary; profile: TenantProfile | null }>(`/api/tenants/${tenantId}`);

export interface CommitActionInput {
  layerKey: string;
  title: string;
  detail?: string;
  predictedImpact?: string;
  timing?: string;
  owner?: string;
  basis: "verified" | "modelled";
  confidence: number;
}

export async function commitAction(
  tenantId: string,
  input: CommitActionInput,
): Promise<CommitOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = await res.json();
    return { ok: true, action: data.action as CommittedAction };
  } catch {
    return { error: "failed" };
  }
}

export async function setActionStatus(
  tenantId: string,
  actionId: string,
  status: CommittedAction["status"],
  note?: string,
): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/actions/${actionId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note }),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

// ── Phase X: benchmark consent (default-off participation) ──
export type ConsentOutcome =
  | { unauthorized: true }
  | { ok: true; optIn: boolean; changed: boolean }
  | { error: string };

export const fetchBenchmarkConsent = (tenantId: string) =>
  getDetail<BenchmarkConsentState>(`/api/tenants/${tenantId}/benchmark-consent`);

export async function setBenchmarkConsent(
  tenantId: string,
  optIn: boolean,
  reason?: string,
): Promise<ConsentOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/benchmark-consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optIn, reason }),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = (await res.json()) as { optIn: boolean; changed: boolean };
    return { ok: true, optIn: data.optIn, changed: data.changed };
  } catch {
    return { error: "failed" };
  }
}
