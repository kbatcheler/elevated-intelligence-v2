// The ingestion console data layer (Phase AE). Framework-free helpers mirroring
// adminApi: a 401 surfaces as { unauthorized: true } so the component can log out,
// list state is derived here, and a freshly minted credential is returned exactly
// once for a one-shot reveal (the server only ever stores its hash or ciphertext,
// so it can never be recovered later). Manual upload sends the raw file bytes as
// the request body (no multipart dependency) and returns the server's honest
// derived-vs-discarded report.

export interface IngestionKey {
  id: string;
  label: string;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface WebhookSource {
  id: string;
  label: string;
  targetLayer: string;
  status: string;
  lastDeliveryAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface DiscardedFacts {
  filename: string;
  bytes: number;
  rawRows?: number;
  rawTextChars?: number;
  note: string;
}

export interface UploadReport {
  accepted: boolean;
  fileType: string;
  kind: string;
  layer: string;
  rootHash: string;
  signalsCount: number;
  derived: string[];
  discarded: DiscardedFacts;
}

export interface MintedKey {
  keyId: string;
  label: string;
  token: string;
}

export interface MintedSource {
  sourceId: string;
  label: string;
  targetLayer: string;
  deliveryPath: string;
  signingSecret: string;
}

export type ListOutcome<T> =
  | { unauthorized: true }
  | { state: "ready" | "empty"; items: T[] }
  | { state: "error" };

export type WriteOutcome = { unauthorized: true } | { ok: true } | { error: string };
export type MintKeyOutcome = { unauthorized: true } | { minted: MintedKey } | { error: string };
export type MintSourceOutcome = { unauthorized: true } | { minted: MintedSource } | { error: string };
export type UploadOutcome = { unauthorized: true } | { report: UploadReport } | { error: string };

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

export const fetchIngestionKeys = (tenantId: string) =>
  getList<IngestionKey>(`/api/tenants/${tenantId}/ingestion-keys`, "keys");

export const fetchWebhookSources = (tenantId: string) =>
  getList<WebhookSource>(`/api/tenants/${tenantId}/webhook-sources`, "sources");

export async function mintIngestionKey(tenantId: string, label: string): Promise<MintKeyOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/ingestion-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = await res.json();
    return { minted: { keyId: data.keyId, label: data.label, token: data.token } };
  } catch {
    return { error: "failed" };
  }
}

export async function revokeIngestionKey(tenantId: string, keyId: string): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/ingestion-keys/${keyId}/revoke`, {
      method: "POST",
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

export async function mintWebhookSource(
  tenantId: string,
  label: string,
  targetLayer: string,
): Promise<MintSourceOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/webhook-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, targetLayer }),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = await res.json();
    return {
      minted: {
        sourceId: data.sourceId,
        label: data.label,
        targetLayer: data.targetLayer,
        deliveryPath: data.deliveryPath,
        signingSecret: data.signingSecret,
      },
    };
  } catch {
    return { error: "failed" };
  }
}

export async function revokeWebhookSource(
  tenantId: string,
  sourceId: string,
): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/webhook-sources/${sourceId}/revoke`, {
      method: "POST",
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

export async function uploadFile(
  tenantId: string,
  layer: string,
  file: File,
): Promise<UploadOutcome> {
  try {
    const url =
      `/api/tenants/${tenantId}/uploads?layer=${encodeURIComponent(layer)}` +
      `&filename=${encodeURIComponent(file.name)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = (await res.json()) as UploadReport;
    return { report: data };
  } catch {
    return { error: "failed" };
  }
}
