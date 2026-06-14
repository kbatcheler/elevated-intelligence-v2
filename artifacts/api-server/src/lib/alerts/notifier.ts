import { asc, eq } from "drizzle-orm";
import { alertEventsTable, db, type AlertEventRow } from "@workspace/db";
import { stripDashes, type Logger } from "@workspace/cortex";
import { logger } from "../logger";

// The Phase P notifier: the sink that CONSUMES the Phase O alert seam. The seam
// (DbAlerter) records every operational event as a pending alert_events row;
// this drainer reads those pending rows and delivers each to one configured
// transport exactly once, then flips the row to sent (or failed). Producers
// stay decoupled from the sink: nothing that emits an alert knows or cares which
// transport is wired.
//
// Transport selection is env-driven: a Slack webhook, a generic webhook, or a
// log sink as the honest default for local development (an operator running
// without a webhook still sees every alert in the logs, never silently dropped).

export type NotifierKind = "slack" | "webhook" | "log";

export interface NotifierTransport {
  readonly kind: NotifierKind;
  // Deliver one alert. Returns normally on success (the drainer marks the row
  // sent) and throws on a delivery failure (the drainer marks it failed).
  deliver(alert: AlertEventRow): Promise<void>;
}

// A single operator-facing line, safe to forward to a chat sink. The alert
// message and details are operator-safe by construction at the seam (no secret,
// no raw record); stripDashes enforces the ASCII-hyphen rule on anything that
// may carry model-generated text.
export function formatAlertText(alert: AlertEventRow): string {
  const head = ["[" + alert.severity.toUpperCase() + "]", alert.type];
  if (alert.tenantId) head.push("tenant=" + alert.tenantId);
  if (alert.connectorKey) head.push("connector=" + alert.connectorKey);
  const body = stripDashes(alert.message);
  const detail = formatDetails(alert.details);
  return detail ? head.join(" ") + " " + body + " (" + detail + ")" : head.join(" ") + " " + body;
}

function formatDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const entries: string[] = [];
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    // Scalars only by construction; skip any non-scalar defensively rather than
    // serialise an unexpected object onto the wire.
    if (typeof v === "object") continue;
    entries.push(k + "=" + stripDashes(String(v)));
  }
  return entries.join(", ");
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("notifier sink responded " + res.status);
  } finally {
    clearTimeout(timer);
  }
}

// The default, always-available sink. Delivery is a structured log line, so it
// never fails and never drops an alert; it just does not leave the host.
export class LogNotifierTransport implements NotifierTransport {
  readonly kind = "log" as const;
  constructor(private readonly log: Logger) {}
  async deliver(alert: AlertEventRow): Promise<void> {
    this.log.info(
      { alertType: alert.type, severity: alert.severity, alertId: alert.id },
      formatAlertText(alert),
    );
  }
}

export class SlackNotifierTransport implements NotifierTransport {
  readonly kind = "slack" as const;
  constructor(
    private readonly webhookUrl: string,
    private readonly timeoutMs: number,
  ) {}
  async deliver(alert: AlertEventRow): Promise<void> {
    await postJson(this.webhookUrl, { text: formatAlertText(alert) }, this.timeoutMs);
  }
}

export class WebhookNotifierTransport implements NotifierTransport {
  readonly kind = "webhook" as const;
  constructor(
    private readonly webhookUrl: string,
    private readonly timeoutMs: number,
  ) {}
  async deliver(alert: AlertEventRow): Promise<void> {
    await postJson(
      this.webhookUrl,
      {
        type: alert.type,
        severity: alert.severity,
        tenantId: alert.tenantId,
        connectorKey: alert.connectorKey,
        entityType: alert.entityType,
        entityId: alert.entityId,
        message: stripDashes(alert.message),
        details: alert.details ?? null,
        createdAt: alert.createdAt,
        text: formatAlertText(alert),
      },
      this.timeoutMs,
    );
  }
}

function timeoutMsFromEnv(): number {
  const raw = process.env.ALERT_NOTIFIER_TIMEOUT_MS;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

/** Construct the env-selected transport. Slack wins over a generic webhook; the log sink is the honest default. */
export function getNotifierTransport(log: Logger = logger): NotifierTransport {
  const slack = process.env.SLACK_WEBHOOK_URL;
  if (slack && slack.trim() !== "") return new SlackNotifierTransport(slack.trim(), timeoutMsFromEnv());
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook && webhook.trim() !== "")
    return new WebhookNotifierTransport(webhook.trim(), timeoutMsFromEnv());
  return new LogNotifierTransport(log);
}

export interface DrainResult {
  delivered: number;
  failed: number;
}

// Drain pending alert rows to the sink exactly once each. Rows are claimed with
// SELECT ... FOR UPDATE SKIP LOCKED inside one transaction, so a second drainer
// tick, or a second instance, never re-sends a row another drainer holds. A
// delivered row flips to sent; a failed delivery flips to failed (terminal and
// still visible in the Operations alert feed), never silently retried into a
// double send. This status transition is what proves a deliberately failed seed
// fires exactly one notification.
export async function drainPendingAlerts(
  opts: { transport?: NotifierTransport; limit?: number } = {},
): Promise<DrainResult> {
  const transport = opts.transport ?? getNotifierTransport();
  const limit = opts.limit ?? 50;
  let delivered = 0;
  let failed = 0;

  await db.transaction(async (tx) => {
    const claimed = await tx
      .select()
      .from(alertEventsTable)
      .where(eq(alertEventsTable.notificationStatus, "pending"))
      .orderBy(asc(alertEventsTable.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    for (const row of claimed) {
      try {
        await transport.deliver(row);
        await tx
          .update(alertEventsTable)
          .set({ notificationStatus: "sent" })
          .where(eq(alertEventsTable.id, row.id));
        delivered += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        logger.warn({ alertId: row.id, err: message }, "alert delivery failed");
        await tx
          .update(alertEventsTable)
          .set({ notificationStatus: "failed" })
          .where(eq(alertEventsTable.id, row.id));
        failed += 1;
      }
    }
  });

  return { delivered, failed };
}

export interface NotifierHandle {
  stop: () => void;
}

// Start the in-process notifier drainer. Called ONLY from the server entrypoint,
// never from app.ts, so importing the app in a test never starts a timer. Ticks
// never overlap, a tick failure is logged and never crashes the loop, and the
// timer is unref'd so it does not keep the process alive on its own. This
// mirrors startConnectorMaintenance exactly.
export function startAlertNotifier(
  log: Logger = logger,
  options: { intervalMs?: number } = {},
): NotifierHandle {
  const intervalMs = options.intervalMs ?? intervalFromEnv();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await drainPendingAlerts();
      if (result.delivered > 0 || result.failed > 0) {
        log.info(
          { delivered: result.delivered, failed: result.failed },
          "alert notifier drained",
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "alert notifier tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}

function intervalFromEnv(): number {
  const raw = process.env.ALERT_DRAIN_INTERVAL_MS;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 20_000;
}
