import type { PushChannel, PushNotifications, PushRule } from "../types";

// The Proactive Push Intelligence data layer (Phase Z). Same posture as the
// other portal API helpers: framework-free fetch that maps each HTTP status to a
// stable discriminated outcome, so the page renders honest distinct states and
// every helper unit-tests with a mocked fetch and no DOM. A 401 is its own
// outcome so the caller can log out; everything else is a ready payload, a typed
// server error code, or a generic failure.

export type NotificationsOutcome =
  | { unauthorized: true }
  | { state: "ready"; data: PushNotifications }
  | { state: "error" };

export type RulesOutcome =
  | { unauthorized: true }
  | { state: "ready"; rules: PushRule[] }
  | { state: "error" };

export type MutationOutcome = { unauthorized: true } | { ok: true } | { error: string };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || "failed";
}

// A tiny in-process pub/sub so the nav bell badge cannot drift from the center.
// The bell refetches its unread count on navigation, but a mark-read or
// read-all happens without a route change; these helpers fire after a successful
// mutation so any subscribed bell re-reads the honest count immediately.
type UnreadListener = () => void;
const unreadListeners = new Set<UnreadListener>();

export function onUnreadInvalidated(listener: UnreadListener): () => void {
  unreadListeners.add(listener);
  return () => {
    unreadListeners.delete(listener);
  };
}

function emitUnreadInvalidated(): void {
  for (const listener of unreadListeners) listener();
}

// The notification center always exists for a seat that can see tenants (it is
// an empty list with a zero badge when nothing has fired), so there is no
// "empty" outcome distinct from "ready"; the page renders the honest zero state.
export async function fetchNotifications(): Promise<NotificationsOutcome> {
  try {
    const res = await fetch("/api/push/notifications");
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as PushNotifications;
    return { state: "ready", data };
  } catch {
    return { state: "error" };
  }
}

export async function fetchPushRules(): Promise<RulesOutcome> {
  try {
    const res = await fetch("/api/push/rules");
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { rules: PushRule[] };
    return { state: "ready", rules: data.rules };
  } catch {
    return { state: "error" };
  }
}

export async function markNotificationRead(id: string): Promise<MutationOutcome> {
  const out = await mutate(`/api/push/notifications/${id}/read`, "POST");
  if ("ok" in out) emitUnreadInvalidated();
  return out;
}

export async function markAllNotificationsRead(): Promise<MutationOutcome> {
  const out = await mutate("/api/push/notifications/read-all", "POST");
  if ("ok" in out) emitUnreadInvalidated();
  return out;
}

export interface RulePatch {
  enabled?: boolean;
  minImpactUsd?: number | null;
  minConfidence?: number | null;
  channel?: PushChannel;
}

export async function patchPushRule(id: string, patch: RulePatch): Promise<MutationOutcome> {
  return mutate(`/api/push/rules/${id}`, "PATCH", patch);
}

// Mute a rule for a number of hours, or unmute with 0. A muted rule still
// records its breaches as suppressed events, so the history is never lost.
export async function mutePushRule(id: string, hours: number): Promise<MutationOutcome> {
  return mutate(`/api/push/rules/${id}/mute`, "POST", { hours });
}

async function mutate(url: string, method: string, body?: unknown): Promise<MutationOutcome> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}
