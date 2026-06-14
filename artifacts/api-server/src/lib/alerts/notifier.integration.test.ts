import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "@workspace/cortex";
import { alertEventsTable, db, type AlertEventRow } from "@workspace/db";
import {
  drainPendingAlerts,
  formatAlertText,
  getNotifierTransport,
  type NotifierTransport,
} from "./notifier";

// The Phase P notifier against a real Postgres. The headline acceptance proof: a
// deliberately failed seed (a pending seed_run_failed row) is delivered EXACTLY
// ONCE to the sink, never once per drain tick. A failing delivery flips the row
// to failed (terminal and visible) and is never retried into a double send.
// Because vitest runs files in parallel against the shared database, every
// assertion is scoped to this file's own rows; the drainer legitimately drains
// other pending rows too, which is correct behaviour, so we never assert on the
// global counts. Rows are namespaced and removed afterwards.

const createdIds: string[] = [];

async function seedPending(message: string): Promise<string> {
  const [row] = await db
    .insert(alertEventsTable)
    .values({
      type: "seed_run_failed",
      severity: "critical",
      tenantId: null,
      entityType: "pipeline_run",
      entityId: randomUUID(),
      message,
    })
    .returning({ id: alertEventsTable.id });
  createdIds.push(row!.id);
  return row!.id;
}

class RecordingTransport implements NotifierTransport {
  readonly kind = "log" as const;
  readonly delivered: string[] = [];
  async deliver(alert: AlertEventRow): Promise<void> {
    this.delivered.push(alert.id);
  }
}

class FailingTransport implements NotifierTransport {
  readonly kind = "webhook" as const;
  async deliver(): Promise<void> {
    throw new Error("sink unreachable");
  }
}

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(alertEventsTable).where(inArray(alertEventsTable.id, createdIds));
  }
});

describe("drainPendingAlerts", () => {
  it("delivers a pending alert exactly once and marks it sent; a second drain re-delivers nothing", async () => {
    const id = await seedPending("notifier-once " + randomUUID());

    const transport = new RecordingTransport();
    await drainPendingAlerts({ transport, limit: 200 });
    expect(transport.delivered.filter((d) => d === id)).toHaveLength(1);

    const [afterFirst] = await db
      .select({ status: alertEventsTable.notificationStatus })
      .from(alertEventsTable)
      .where(eq(alertEventsTable.id, id));
    expect(afterFirst!.status).toBe("sent");

    const second = new RecordingTransport();
    await drainPendingAlerts({ transport: second, limit: 200 });
    expect(second.delivered).not.toContain(id);
  });

  it("marks a row failed (not sent) when delivery throws, and never picks it up again", async () => {
    const id = await seedPending("notifier-fail " + randomUUID());

    await drainPendingAlerts({ transport: new FailingTransport(), limit: 200 });
    const [row] = await db
      .select({ status: alertEventsTable.notificationStatus })
      .from(alertEventsTable)
      .where(eq(alertEventsTable.id, id));
    expect(row!.status).toBe("failed");

    const retry = new RecordingTransport();
    await drainPendingAlerts({ transport: retry, limit: 200 });
    expect(retry.delivered).not.toContain(id);
  });
});

describe("formatAlertText", () => {
  it("renders one operator-safe line with routing, body, and scalar details", () => {
    const row = {
      id: "a",
      type: "connector_error_transition",
      severity: "critical",
      tenantId: "t-1",
      connectorKey: "redshift",
      entityType: "connection",
      entityId: "c-1",
      message: "connection went to error",
      details: { reason: "auth expired", attempts: 3 },
      notificationStatus: "pending",
      createdAt: new Date(),
    } as unknown as AlertEventRow;

    const text = formatAlertText(row);
    expect(text).toContain("[CRITICAL]");
    expect(text).toContain("connector_error_transition");
    expect(text).toContain("tenant=t-1");
    expect(text).toContain("connector=redshift");
    expect(text).toContain("connection went to error");
    expect(text).toContain("reason=auth expired");
    expect(text).toContain("attempts=3");
    // The ASCII-hyphen rule holds on the operator line: no en or em dash.
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("skips any non-scalar detail rather than serialising an object onto the wire", () => {
    const row = {
      id: "b",
      type: "seed_run_failed",
      severity: "warning",
      tenantId: null,
      connectorKey: null,
      entityType: null,
      entityId: null,
      message: "x",
      details: { ok: true, nested: { secret: "should not appear" } },
      notificationStatus: "pending",
      createdAt: new Date(),
    } as unknown as AlertEventRow;

    const text = formatAlertText(row);
    expect(text).toContain("ok=true");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("should not appear");
  });
});

describe("getNotifierTransport selection", () => {
  const KEYS = ["SLACK_WEBHOOK_URL", "ALERT_WEBHOOK_URL"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to the log sink when no webhook is configured", () => {
    expect(getNotifierTransport(silentLogger).kind).toBe("log");
  });

  it("prefers Slack over a generic webhook", () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/x";
    expect(getNotifierTransport(silentLogger).kind).toBe("slack");
  });

  it("uses the generic webhook when only it is configured", () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
    expect(getNotifierTransport(silentLogger).kind).toBe("webhook");
  });
});
