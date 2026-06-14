import type { Pin } from "../types";
import type { ListOutcome, MintOutcome, WriteOutcome } from "./adminApi";

// The client-admin onboarding data layer. Same framework-free shape as adminApi:
// pure helpers that own the 401 detection, the list-state derivation and the
// error-code extraction so they unit test with a mocked fetch and keep the
// component thin. Every route is scoped server-side to the caller's own org and
// the client-viewer role, so these helpers never send a scope of their own.

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || "failed";
}

export async function fetchViewerPins(): Promise<ListOutcome<Pin>> {
  try {
    const res = await fetch("/api/client/viewer-pins");
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const items = ((data as Record<string, unknown>).pins ?? []) as Pin[];
    return { state: items.length > 0 ? "ready" : "empty", items };
  } catch {
    return { state: "error" };
  }
}

export async function mintViewerPin(payload: {
  label: string;
  maxUses: number;
  expiresInDays: number;
}): Promise<MintOutcome> {
  try {
    const res = await fetch("/api/client/viewer-pins", {
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

export async function revokeViewerPin(id: string): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/client/viewer-pins/${id}/revoke`, { method: "POST" });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: "failed" };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}
