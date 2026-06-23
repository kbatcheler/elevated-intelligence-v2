// The Intelligence Gap Assessment report email seam (Phase AT). Mirrors the
// Phase P notifier exactly: an env-selected transport with a log sink as the
// honest default for local development. It is "available, not connected" by
// default, so a prospect always gets their forwardable link on screen and the
// email is strictly best-effort: a not_connected or failed send NEVER blocks the
// link. No SDK, no new dependency: an HTTP transport posts over the Node global
// fetch. A configured bearer is sent as an Authorization header and is never
// logged.

import { stripDashes, type Logger } from "@workspace/cortex";
import { logger } from "../logger";

export type EmailDeliveryStatus = "sent" | "not_connected" | "failed";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  transport: "http" | "log";
  reason?: string;
}

export interface EmailTransport {
  readonly kind: "http" | "log";
  deliver(message: EmailMessage): Promise<EmailDeliveryResult>;
}

function timeoutMsFromEnv(): number {
  const raw = process.env.ASSESSMENT_EMAIL_TIMEOUT_MS;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

// The default, always-available sink. It does not leave the host: it records the
// intent in the logs (never the body) and reports not_connected honestly, so an
// operator running without an email provider still sees that a send was
// attempted and is never told a mail was sent that was not.
export class LogEmailTransport implements EmailTransport {
  readonly kind = "log" as const;
  constructor(private readonly log: Logger) {}
  async deliver(message: EmailMessage): Promise<EmailDeliveryResult> {
    this.log.info(
      { to: message.to, subject: stripDashes(message.subject) },
      "assessment report email not connected: no email provider configured",
    );
    return { status: "not_connected", transport: "log" };
  }
}

// The HTTP transport. Posts a small JSON body to a configured endpoint over the
// global fetch; a bearer is attached only when set and is never logged. A
// non-2xx response or a transport error reports failed, never throwing, so the
// report link is always returned regardless.
export class HttpEmailTransport implements EmailTransport {
  readonly kind = "http" as const;
  constructor(
    private readonly endpoint: string,
    private readonly token: string | null,
    private readonly timeoutMs: number,
  ) {}
  async deliver(message: EmailMessage): Promise<EmailDeliveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.token) headers.authorization = "Bearer " + this.token;
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: message.to,
          subject: stripDashes(message.subject),
          text: stripDashes(message.text),
        }),
        signal: controller.signal,
      });
      if (!res.ok) return { status: "failed", transport: "http", reason: "provider responded " + res.status };
      return { status: "sent", transport: "http" };
    } catch (err) {
      return { status: "failed", transport: "http", reason: err instanceof Error ? err.message : "unknown error" };
    } finally {
      clearTimeout(timer);
    }
  }
}

// Construct the env-selected transport. ASSESSMENT_EMAIL_PROVIDER=http selects
// the HTTP transport (and requires ASSESSMENT_EMAIL_ENDPOINT to connect); unset
// or any other value is the honest log sink.
export function getEmailTransport(log: Logger = logger): EmailTransport {
  const provider = (process.env.ASSESSMENT_EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "http") {
    const endpoint = (process.env.ASSESSMENT_EMAIL_ENDPOINT ?? "").trim();
    if (endpoint !== "") {
      const token = (process.env.ASSESSMENT_EMAIL_TOKEN ?? "").trim();
      return new HttpEmailTransport(endpoint, token === "" ? null : token, timeoutMsFromEnv());
    }
    // Selected but not configured: fall through to the honest log sink rather
    // than crash, mirroring the available-not-connected posture of the seams.
    log.warn({}, "assessment email provider http selected but ASSESSMENT_EMAIL_ENDPOINT is unset");
  }
  return new LogEmailTransport(log);
}

// Send the forwardable report link to a captured contact. Best-effort by design:
// the returned status is reported back to the caller but never gates the link.
export async function sendAssessmentReportEmail(
  opts: { to: string; name: string | null; reportUrl: string },
  log: Logger = logger,
): Promise<EmailDeliveryResult> {
  const transport = getEmailTransport(log);
  const greeting = opts.name && opts.name.trim() !== "" ? "Hello " + opts.name.trim() : "Hello";
  const message: EmailMessage = {
    to: opts.to,
    subject: "Your Intelligence Gap Assessment",
    text:
      greeting +
      ",\n\nYour Intelligence Gap Assessment is ready. You can open and forward it here:\n" +
      opts.reportUrl +
      "\n\nElevated Intelligence",
  };
  return transport.deliver(message);
}
