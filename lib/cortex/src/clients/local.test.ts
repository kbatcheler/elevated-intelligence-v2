// The in-boundary adapter, proven against a real local HTTP server (node:http).
// No live local model is required: a node:http server stands in for the
// self-hosted OpenAI-compatible endpoint, so the adapter's transport, parsing,
// validation, corrective retry, 429 backoff, and fail-loud behaviour are all
// exercised end to end.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { callLocalJson, getExtractionRuntime } from "./local";
import type { LocalSeatConfig } from "../config";

const schema = z.object({ answer: z.string(), n: z.number() });
type Answer = z.infer<typeof schema>;

// One request handler the tests swap per case. Returns the raw body string and
// status so a case can return a 500, a 429, malformed JSON, or a good payload.
type Handler = (req: IncomingMessage, body: string) => { status: number; headers?: Record<string, string>; body: string };

let server: Server;
let baseUrl: string;
let handler: Handler;
const received: Array<{ headers: IncomingMessage["headers"]; body: unknown }> = [];

function chatCompletion(content: unknown): string {
  return JSON.stringify({
    model: "local-test-model",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  });
}

beforeEach(async () => {
  received.length = 0;
  handler = (_req, _body) => ({ status: 200, body: chatCompletion({ answer: "ok", n: 1 }) });
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: raw ? JSON.parse(raw) : null });
      const out = handler(req, raw);
      res.writeHead(out.status, { "content-type": "application/json", ...(out.headers ?? {}) });
      res.end(out.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seat(extra?: Partial<LocalSeatConfig>): LocalSeatConfig {
  return { provider: "local", model: "local-test-model", baseUrl, ...extra };
}

describe("callLocalJson (in-boundary adapter transport)", () => {
  it("posts to /v1/chat/completions, parses and validates the response", async () => {
    const res = await callLocalJson<Answer>({ seat: seat(), system: "S", user: "U", schema });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ answer: "ok", n: 1 });
    expect(res.model).toBe("local-test-model");
    expect(res.inputTokens).toBe(11);
    expect(res.outputTokens).toBe(7);
    // The request body carries the OpenAI-compatible shape with JSON mode and no
    // tools/web-search of any kind: the in-boundary Lens never reaches the web.
    const sent = received[0]?.body as Record<string, unknown>;
    expect(sent["model"]).toBe("local-test-model");
    expect(sent["response_format"]).toEqual({ type: "json_object" });
    expect(JSON.stringify(sent)).not.toContain("web_search");
    expect(JSON.stringify(sent)).not.toContain("tools");
  });

  it("sends a Bearer token only when an apiKey is configured", async () => {
    await callLocalJson<Answer>({ seat: seat({ apiKey: "secret-token" }), system: "S", user: "U", schema });
    expect(received[0]?.headers["authorization"]).toBe("Bearer secret-token");
    received.length = 0;
    await callLocalJson<Answer>({ seat: seat(), system: "S", user: "U", schema });
    expect(received[0]?.headers["authorization"]).toBeUndefined();
  });

  it("fails loud (never fakes output) on a non-2xx response", async () => {
    handler = () => ({ status: 500, body: "upstream boom" });
    const res = await callLocalJson<Answer>({ seat: seat(), system: "S", user: "U", schema });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain("HTTP 500");
  });

  it("feeds a schema miss back and succeeds on the corrective retry", async () => {
    let call = 0;
    handler = () => {
      call += 1;
      return call === 1
        ? { status: 200, body: chatCompletion({ wrong: "shape" }) }
        : { status: 200, body: chatCompletion({ answer: "fixed", n: 2 }) };
    };
    const res = await callLocalJson<Answer>({ seat: seat(), system: "S", user: "U", schema });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ answer: "fixed", n: 2 });
    // Two requests: the original and the informed retry carrying the correction.
    expect(received).toHaveLength(2);
    const retryBody = received[1]?.body as { messages: Array<{ role: string }> };
    expect(retryBody.messages.length).toBeGreaterThan(2);
  });

  it("respects a 429 then succeeds once the backoff clears", async () => {
    let call = 0;
    handler = () => {
      call += 1;
      return call === 1
        ? { status: 429, headers: { "retry-after": "0.01" }, body: "{}" }
        : { status: 200, body: chatCompletion({ answer: "after-429", n: 3 }) };
    };
    const res = await callLocalJson<Answer>({ seat: seat(), system: "S", user: "U", schema });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.answer).toBe("after-429");
    expect(received.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getExtractionRuntime (honest availability)", () => {
  it("returns null when no local model is configured", () => {
    expect(getExtractionRuntime({})).toBeNull();
    expect(getExtractionRuntime({ LOCAL_MODEL_BASE_URL: baseUrl })).toBeNull();
    expect(getExtractionRuntime({ LOCAL_MODEL_MODEL: "m" })).toBeNull();
  });

  it("returns a working runtime when fully configured, and calls the server", async () => {
    const runtime = getExtractionRuntime({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_MODEL: "local-test-model" });
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    expect(runtime.model).toBe("local-test-model");
    expect(runtime.endpoint).toBe(`${baseUrl}/v1/chat/completions`);
    const res = await runtime.callJson<Answer>({ system: "S", user: "U", schema });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ answer: "ok", n: 1 });
  });
});
