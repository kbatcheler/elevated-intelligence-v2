import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  getSentryReporter,
  HttpSentryReporter,
  NoopSentryReporter,
  parseDsn,
  setSentryReporter,
} from "./sentryReporter";

// The Sentry reporter is "available, not connected" until a DSN is set: parsing
// is total (never throws), the no-DSN default is an honest no-op, and the HTTP
// path speaks the envelope protocol with NO SDK and forwards only allowlisted
// scalar tags, never raw client data. Every delivery failure is swallowed so
// observability can never break the request path. No real network is used here.

afterEach(() => {
  setSentryReporter(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseDsn", () => {
  it("returns null for an absent, empty, or whitespace DSN", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("   ")).toBeNull();
  });

  it("returns null for a malformed DSN or one missing a key or project id", () => {
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://example.com")).toBeNull();
  });

  it("parses a standard DSN into an envelope URL", () => {
    const parsed = parseDsn("https://abc123@o1.ingest.sentry.io/4567");
    expect(parsed).not.toBeNull();
    expect(parsed!.publicKey).toBe("abc123");
    expect(parsed!.projectId).toBe("4567");
    expect(parsed!.envelopeUrl).toBe("https://o1.ingest.sentry.io/api/4567/envelope/");
  });

  it("handles a path prefix before the project id", () => {
    const parsed = parseDsn("https://key@host.example.com/path/to/89");
    expect(parsed!.projectId).toBe("89");
    expect(parsed!.envelopeUrl).toBe("https://host.example.com/path/to/api/89/envelope/");
  });
});

describe("NoopSentryReporter", () => {
  it("reports available-not-connected and skips every report", async () => {
    const reporter = new NoopSentryReporter();
    expect(reporter.status()).toBe("available_not_connected");
    expect(await reporter.reportError(new Error("x"))).toBe("skipped");
  });
});

describe("getSentryReporter", () => {
  it("is the honest no-op when no DSN is configured", () => {
    const saved = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    setSentryReporter(null);
    try {
      expect(getSentryReporter().status()).toBe("available_not_connected");
    } finally {
      if (saved === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = saved;
      setSentryReporter(null);
    }
  });
});

describe("HttpSentryReporter", () => {
  const dsn = parseDsn("https://pub@o1.ingest.sentry.io/42")!;

  it("POSTs a Sentry envelope carrying only allowlisted scalar tags", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response("", { status: 200 });
      }),
    );

    const reporter = new HttpSentryReporter(dsn, 1000);
    const outcome = await reporter.reportError(new Error("boom"), {
      subsystem: "orchestrator",
      tenantId: "t-1",
      level: "error",
    });

    expect(outcome).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(dsn.envelopeUrl);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(headers["x-sentry-auth"]).toContain("sentry_key=pub");

    const lines = String(calls[0]!.init.body).trim().split("\n");
    expect(lines).toHaveLength(3); // envelope header, item header, event
    const event = JSON.parse(lines[2]!) as {
      exception: { values: { type: string; value: string }[] };
      tags: Record<string, string>;
    };
    expect(event.exception.values[0]!.value).toBe("boom");
    // Only the allowlisted scalars are present; level is an event field, not a tag.
    expect(event.tags).toEqual({ subsystem: "orchestrator", tenantId: "t-1" });
  });

  it("reports failed (never throws) when the sink rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const reporter = new HttpSentryReporter(dsn, 1000);
    expect(await reporter.reportError(new Error("x"))).toBe("failed");
  });

  it("reports failed when the transport throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const reporter = new HttpSentryReporter(dsn, 1000);
    expect(await reporter.reportError(new Error("x"))).toBe("failed");
  });
});

describe("captureError", () => {
  it("never throws even when the active reporter throws", async () => {
    setSentryReporter({
      status: () => "connected",
      reportError: async () => {
        throw new Error("reporter blew up");
      },
    });
    await expect(captureError(new Error("x"))).resolves.toBeUndefined();
  });
});
