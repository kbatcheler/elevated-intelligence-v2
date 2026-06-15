import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchNotifications,
  fetchPushRules,
  markAllNotificationsRead,
  markNotificationRead,
  mutePushRule,
  patchPushRule,
} from "./pushApi";

type FetchResult = { ok: boolean; status: number; json?: () => Promise<unknown> };

const originalFetch = globalThis.fetch;

function mockFetch(result: FetchResult | Error) {
  const fn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return {
      ok: result.ok,
      status: result.status,
      json: result.json ?? (async () => ({})),
    };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const notifications = {
  notifications: [
    {
      id: "e1",
      tenantId: "t1",
      tenantName: "Acme",
      sourceType: "committed_action",
      sourceId: "a1",
      title: "High value action",
      message: "carries value",
      impactUsd: 100000,
      confidence: 80,
      rankScore: 80000,
      deliveryStatus: "pending",
      channel: "in_app",
      read: false,
      readAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  unreadCount: 1,
};

describe("fetchNotifications", () => {
  it("returns ready with the center payload", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => notifications });
    expect(await fetchNotifications()).toEqual({ state: "ready", data: notifications });
    expect(fn).toHaveBeenCalledWith("/api/push/notifications");
  });

  it("surfaces unauthorized on a 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchNotifications()).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchNotifications()).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await fetchNotifications()).toEqual({ state: "error" });
  });
});

describe("fetchPushRules", () => {
  it("returns ready with the rules array", async () => {
    const rules = [
      {
        id: "r1",
        tenantId: "t1",
        tenantName: "Acme",
        type: "high_value_action",
        enabled: true,
        mutedUntil: null,
        minImpactUsd: null,
        minConfidence: null,
        channel: "in_app",
      },
    ];
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ rules }) });
    expect(await fetchPushRules()).toEqual({ state: "ready", rules });
    expect(fn).toHaveBeenCalledWith("/api/push/rules");
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchPushRules()).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchPushRules()).toEqual({ state: "error" });
  });
});

describe("markNotificationRead", () => {
  it("posts to the per-event read endpoint and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await markNotificationRead("e1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/push/notifications/e1/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await markNotificationRead("e1")).toEqual({ unauthorized: true });
  });

  it("extracts the server error code on a non-ok status", async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    expect(await markNotificationRead("e1")).toEqual({ error: "not_found" });
  });
});

describe("markAllNotificationsRead", () => {
  it("posts to the read-all endpoint", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await markAllNotificationsRead()).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/push/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
  });
});

describe("patchPushRule", () => {
  it("sends the patch body to the rule endpoint", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await patchPushRule("r1", { minImpactUsd: 5000, enabled: false })).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/push/rules/r1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minImpactUsd: 5000, enabled: false }),
    });
  });

  it("extracts the server error code on an invalid threshold", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "min_impact_usd_invalid" }) });
    expect(await patchPushRule("r1", { minImpactUsd: -1 })).toEqual({
      error: "min_impact_usd_invalid",
    });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await patchPushRule("r1", { enabled: true })).toEqual({ error: "failed" });
  });
});

describe("mutePushRule", () => {
  it("posts the hours body to the mute endpoint", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await mutePushRule("r1", 24)).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/push/rules/r1/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 24 }),
    });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await mutePushRule("r1", 0)).toEqual({ unauthorized: true });
  });
});
