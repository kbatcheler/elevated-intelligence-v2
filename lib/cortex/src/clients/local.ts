// The in-boundary extraction adapter (Tier 2, the split pipeline). In connected
// mode the Lens stages (perceive, hypothesise) run here, against a self-hosted or
// open model inside the deployment boundary, so the client's own derived signals
// are interpreted before anything reaches an external provider. The model
// identifier and endpoint come from the environment (resolveLocalSeat); no model
// string lives in this file.
//
// Transport is a raw fetch to an OpenAI-compatible /v1/chat/completions endpoint
// (the de-facto interface every self-hosted server, vLLM, Ollama, TGI, llama.cpp,
// speaks), so no new dependency is added. The same 429-backoff and one
// self-correcting retry discipline as the external clients applies. There is no
// web-search or tool option by construction: the in-boundary Lens grounds on the
// client's own signals, not the public web.
//
// Honesty: when no in-boundary model is configured, getExtractionRuntime returns
// null and the caller fails loudly with "available, not connected". This adapter
// never stubs or fakes an output.

import { type ZodType } from "zod/v4";
import { resolveLocalSeat, type LocalSeatConfig } from "../config";
import { buildSchemaCorrection, parseAndValidate } from "../json";
import { silentLogger, type Logger } from "../logger";
import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionZoneRuntime,
} from "../stages/extractionZone";

export type LocalCallOptions<T> = {
  seat: LocalSeatConfig;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens?: number;
  log?: Logger;
  context?: string;
};

// The model's own rejected output and the schema error, fed back on retry.
type Correction = { badText: string; reason: string };

function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
}

async function callOnce<T>(opts: LocalCallOptions<T>, correction?: Correction): Promise<ExtractionResult<T>> {
  const tStart = Date.now();
  const log = opts.log ?? silentLogger;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  if (correction) {
    messages.push({ role: "assistant", content: correction.badText.slice(0, 8000) });
    messages.push({ role: "user", content: buildSchemaCorrection(correction.reason) });
  }
  const body: Record<string, unknown> = {
    model: opts.seat.model,
    max_tokens: opts.maxTokens ?? 8192,
    temperature: 0,
    messages,
    // The OpenAI-compatible JSON mode every modern self-hosted server honours.
    response_format: { type: "json_object" },
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.seat.apiKey) headers["authorization"] = `Bearer ${opts.seat.apiKey}`;

  // Inner loop: respect Retry-After on 429s, up to 4 sub-attempts.
  let apiRes: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    apiRes = await fetch(chatUrl(opts.seat.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (apiRes.status !== 429) break;
    const ra = Number(apiRes.headers.get("retry-after"));
    const waitMs = Math.min(45_000, (Number.isFinite(ra) && ra > 0 ? ra : 5 + attempt * 5) * 1000);
    log.warn({ ctx: opts.context, attempt, waitMs }, "local model 429, backing off");
    await apiRes.text().catch(() => undefined);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (!apiRes || !apiRes.ok) {
    const status = apiRes?.status ?? 0;
    // Drain the body so the socket frees, but never log it: a local server may
    // echo the request (the sensitive derived-signal prompt) in its error, and
    // application logs are outside the extraction boundary. Status only.
    if (apiRes) await apiRes.text().catch(() => undefined);
    log.error({ ctx: opts.context, status }, "local model call non-2xx");
    return { ok: false, reason: `local model HTTP ${status}`, durationMs: Date.now() - tStart };
  }

  const payload = (await apiRes.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  } | null;
  const text = payload?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    return { ok: false, reason: "local model returned no text content", durationMs: Date.now() - tStart };
  }

  const validated = parseAndValidate(opts.schema, text);
  if (!validated.ok) {
    log.warn({ ctx: opts.context, reason: validated.reason }, "local model output rejected");
    return { ok: false, reason: validated.reason, durationMs: Date.now() - tStart, rawText: text };
  }
  return {
    ok: true,
    value: validated.value,
    durationMs: Date.now() - tStart,
    model: payload?.model || opts.seat.model,
    inputTokens: payload?.usage?.prompt_tokens ?? null,
    outputTokens: payload?.usage?.completion_tokens ?? null,
  };
}

/**
 * Call the in-boundary model for a strict JSON response, validate against the
 * schema, and retry once. When the first miss is a schema/parse failure the retry
 * is informed: the model receives its own rejected output and the validation
 * error and is asked to correct it. Never throws.
 */
export async function callLocalJson<T>(opts: LocalCallOptions<T>): Promise<ExtractionResult<T>> {
  const log = opts.log ?? silentLogger;
  let correction: Correction | undefined;
  let last: ExtractionResult<T> = { ok: false, reason: "no attempt made", durationMs: 0 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      last = await callOnce(opts, correction);
    } catch (e) {
      last = { ok: false, reason: e instanceof Error ? e.message : String(e), durationMs: 0 };
    }
    if (last.ok) return last;
    if (attempt === 0) {
      log.info({ ctx: opts.context, attempt: 1, reason: last.reason }, "local model call retrying");
      correction = last.rawText ? { badText: last.rawText, reason: last.reason } : undefined;
    }
  }
  return last;
}

// The default boundary runtime: a plain HTTP adapter to the configured
// self-hosted model. Implements the ExtractionZoneRuntime seam, so a future
// TEE-attested runtime can replace it without any stage or orchestrator change.
class HttpExtractionRuntime implements ExtractionZoneRuntime {
  readonly model: string;
  readonly endpoint: string;
  private readonly seat: LocalSeatConfig;

  constructor(seat: LocalSeatConfig) {
    this.seat = seat;
    this.model = seat.model;
    this.endpoint = chatUrl(seat.baseUrl);
  }

  callJson<T>(req: ExtractionRequest<T>): Promise<ExtractionResult<T>> {
    return callLocalJson<T>({
      seat: this.seat,
      system: req.system,
      user: req.user,
      schema: req.schema,
      maxTokens: req.maxTokens,
      log: req.log,
      context: req.context,
    });
  }
}

// Resolve the configured in-boundary runtime, or null when no local model is
// configured. A null return is the honest "available, not connected" state: the
// caller fails the connected run loudly rather than leaking the sensitive stages
// to an external provider.
export function getExtractionRuntime(env: NodeJS.ProcessEnv = process.env): ExtractionZoneRuntime | null {
  const seat = resolveLocalSeat(env);
  if (!seat) return null;
  return new HttpExtractionRuntime(seat);
}
