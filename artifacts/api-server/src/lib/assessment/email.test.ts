import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "@workspace/cortex";
import { getEmailTransport, sendAssessmentReportEmail } from "./email";

// The assessment report email seam is available, not connected, by default: with
// no provider configured it is the honest log sink, and a send reports
// not_connected rather than claiming a mail left the host. This guarantees the
// forwardable link is never gated on an email provider.

const ENV_KEYS = [
  "ASSESSMENT_EMAIL_PROVIDER",
  "ASSESSMENT_EMAIL_ENDPOINT",
  "ASSESSMENT_EMAIL_TOKEN",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getEmailTransport", () => {
  it("defaults to the log sink when no provider is configured", () => {
    expect(getEmailTransport(silentLogger).kind).toBe("log");
  });

  it("falls back to the log sink when http is selected but no endpoint is set", () => {
    process.env.ASSESSMENT_EMAIL_PROVIDER = "http";
    expect(getEmailTransport(silentLogger).kind).toBe("log");
  });

  it("selects the http transport only when an endpoint is configured", () => {
    process.env.ASSESSMENT_EMAIL_PROVIDER = "http";
    process.env.ASSESSMENT_EMAIL_ENDPOINT = "https://example.com/send";
    expect(getEmailTransport(silentLogger).kind).toBe("http");
  });
});

describe("sendAssessmentReportEmail", () => {
  it("reports not_connected by default and never throws", async () => {
    const result = await sendAssessmentReportEmail(
      { to: "prospect@example.com", name: "Jordan", reportUrl: "https://portal.example.com/a/token" },
      silentLogger,
    );
    expect(result.status).toBe("not_connected");
    expect(result.transport).toBe("log");
  });
});
