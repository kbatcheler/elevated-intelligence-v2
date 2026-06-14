import { randomUUID } from "node:crypto";
import { logger } from "../logger";

// A Sentry-compatible error reporter built on the Node global fetch, with NO
// SDK dependency: it speaks the Sentry envelope HTTP protocol directly. Until a
// DSN is configured it is "available, not connected" (mirroring the KMS
// pattern): construction always succeeds, status() reports the not-connected
// state, and every reportError is an honest no-op that sends nothing. Wiring a
// DSN later switches the same seam to live delivery with no call-site change.
//
// HONESTY on the payload: only an allowlisted set of scalar context fields is
// ever forwarded (subsystem, route, tenantId, runId, layerKey, connectorKey),
// plus the error type, message, and our own stack. Never a request body,
// headers, connector payload, signal value, model raw text, or any secret.

export type SentryLevel = "info" | "warning" | "error" | "fatal";

export interface SentryContext {
  subsystem?: string;
  route?: string;
  tenantId?: string | null;
  runId?: string | null;
  layerKey?: string | null;
  connectorKey?: string | null;
  level?: SentryLevel;
}

export type SentryStatus = "connected" | "available_not_connected";

export type ReportOutcome = "sent" | "skipped" | "failed";

export interface SentryReporter {
  status(): SentryStatus;
  reportError(error: unknown, context?: SentryContext): Promise<ReportOutcome>;
}

export interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
  envelopeUrl: string;
}

// Parse a Sentry DSN of the form scheme://publicKey@host[:port][/path]/projectId.
// Returns null for an absent or malformed DSN, and never throws.
export function parseDsn(raw: string | undefined): ParsedDsn | null {
  if (!raw || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim());
    const publicKey = url.username;
    if (!publicKey) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments[segments.length - 1];
    if (!projectId) return null;
    const prefix = segments.slice(0, -1).join("/");
    const base = url.host + (prefix ? "/" + prefix : "");
    const envelopeUrl = url.protocol + "//" + base + "/api/" + projectId + "/envelope/";
    return { publicKey, host: url.host, projectId, envelopeUrl };
  } catch {
    return null;
  }
}

// Curated, scalar-only tags. The allowlist is fixed, so no arbitrary object,
// secret, or raw record can reach the wire through this function.
function buildTags(context: SentryContext | undefined): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!context) return tags;
  const allow: Array<[string, string | null | undefined]> = [
    ["subsystem", context.subsystem],
    ["route", context.route],
    ["tenantId", context.tenantId],
    ["runId", context.runId],
    ["layerKey", context.layerKey],
    ["connectorKey", context.connectorKey],
  ];
  for (const [k, v] of allow) {
    if (v === undefined || v === null || v === "") continue;
    tags[k] = String(v);
  }
  return tags;
}

function errorParts(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || "Error", value: error.message, stack: error.stack };
  }
  return { type: "Error", value: typeof error === "string" ? error : "Unknown error" };
}

// The honest no-op used until a DSN is configured.
export class NoopSentryReporter implements SentryReporter {
  status(): SentryStatus {
    return "available_not_connected";
  }
  async reportError(): Promise<ReportOutcome> {
    return "skipped";
  }
}

export class HttpSentryReporter implements SentryReporter {
  constructor(
    private readonly dsn: ParsedDsn,
    private readonly timeoutMs: number,
  ) {}

  status(): SentryStatus {
    return "connected";
  }

  async reportError(error: unknown, context?: SentryContext): Promise<ReportOutcome> {
    const eventId = randomUUID().replace(/-/g, "");
    const sentAt = new Date().toISOString();
    const parts = errorParts(error);
    const level = context?.level ?? "error";
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level,
      logger: "ei-v2",
      environment: process.env.NODE_ENV ?? "development",
      ...(process.env.SENTRY_RELEASE ? { release: process.env.SENTRY_RELEASE } : {}),
      exception: { values: [{ type: parts.type, value: parts.value }] },
      tags: buildTags(context),
      ...(parts.stack ? { extra: { stack: parts.stack.slice(0, 4000) } } : {}),
    };
    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: sentAt }) +
      "\n" +
      JSON.stringify({ type: "event" }) +
      "\n" +
      JSON.stringify(event) +
      "\n";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth":
            "Sentry sentry_version=7, sentry_client=ei-v2/1.0, sentry_key=" + this.dsn.publicKey,
        },
        body: envelope,
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "sentry report rejected");
        return "failed";
      }
      return "sent";
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      logger.warn({ err: message }, "sentry report failed");
      return "failed";
    } finally {
      clearTimeout(timer);
    }
  }
}

function timeoutMsFromEnv(): number {
  const raw = process.env.SENTRY_TIMEOUT_MS;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

let activeReporter: SentryReporter | null = null;

/** Returns the process-wide reporter, constructing it from SENTRY_DSN on first use. */
export function getSentryReporter(): SentryReporter {
  if (!activeReporter) {
    const dsn = parseDsn(process.env.SENTRY_DSN);
    activeReporter = dsn
      ? new HttpSentryReporter(dsn, timeoutMsFromEnv())
      : new NoopSentryReporter();
  }
  return activeReporter;
}

/** Test seam: override the active reporter (pass null to reset to the default). */
export function setSentryReporter(reporter: SentryReporter | null): void {
  activeReporter = reporter;
}

// Best-effort capture: never throws, so a reporting failure can never mask or
// interrupt the original error path. reportError is already internally
// best-effort; this extra guard covers getSentryReporter() construction too.
export async function captureError(error: unknown, context?: SentryContext): Promise<void> {
  try {
    await getSentryReporter().reportError(error, context);
  } catch {
    // intentionally swallowed; observability must never break the request path
  }
}
