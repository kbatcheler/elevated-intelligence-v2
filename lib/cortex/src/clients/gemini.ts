// Gemini client for the grounder seat (Confounder, Challenger), hitting the
// Replit AI Integrations managed proxy through the @google/genai SDK. The model
// is always supplied by the caller from CORTEX config; this file holds no model
// identifier.
//
// Grounding non-negotiable: when Google Search grounding is on, the call MUST
// NOT request a JSON response mime type (the tool forbids it). JSON is enforced
// by prompt discipline plus the defensive extractor. searchCalls is read from
// groundingMetadata.webSearchQueries.length.

import { GoogleGenAI, type GroundingChunk } from "@google/genai";
import { type ZodType } from "zod/v4";
import { buildSchemaCorrection, parseAndValidate } from "../json";
import { silentLogger, type Logger } from "../logger";

let cachedClient: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (cachedClient) return cachedClient;
  const baseUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  if (!baseUrl || !apiKey) return null;
  cachedClient = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  return cachedClient;
}

export type GeminiJsonOptions<T> = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  useGrounding?: boolean;
  log?: Logger;
  context?: string;
};

export type GeminiJsonResult<T> =
  | {
      ok: true;
      value: T;
      durationMs: number;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      groundingChunks: Array<{ uri: string; title: string }>;
      searchCallCount: number;
    }
  | {
      ok: false;
      reason: string;
      durationMs: number;
      rawText?: string;
      // Present when a 200 response was received before the failure (a billed
      // call whose output failed schema validation, or returned no text): the
      // tokens were really spent and must still be costed. Absent for a transport
      // error or a missing-env no-call.
      billed?: boolean;
      inputTokens?: number | null;
      outputTokens?: number | null;
      searchCallCount?: number;
    };

// The model's own rejected output and the schema error, fed back on retry.
type Correction = { badText: string; reason: string };

// Whether an SDK error is a transient rate-limit worth backing off on.
function isRateLimit(e: unknown): boolean {
  const status = (e as { status?: number; code?: number } | null)?.status ?? (e as { code?: number } | null)?.code;
  const msg = e instanceof Error ? e.message : String(e);
  return status === 429 || /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg);
}

// generateContent with the same 429 discipline as the Anthropic client: up to 4
// sub-attempts with linear backoff. Grounded confound + challenge are the
// GATE-critical seats, so a burst of concurrent calls must not drop them.
async function generateWithBackoff(
  client: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  log: Logger,
  context: string | undefined,
): ReturnType<GoogleGenAI["models"]["generateContent"]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await client.models.generateContent(params);
    } catch (e) {
      lastErr = e;
      if (!isRateLimit(e) || attempt === 3) throw e;
      const waitMs = Math.min(45_000, (5 + attempt * 5) * 1000);
      log.warn({ ctx: context, attempt, waitMs }, "Gemini 429, backing off");
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function extractGroundingUrls(chunks: GroundingChunk[] | undefined): Array<{ uri: string; title: string }> {
  if (!chunks?.length) return [];
  const seen = new Set<string>();
  const out: Array<{ uri: string; title: string }> = [];
  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web?.uri) continue;
    if (seen.has(web.uri)) continue;
    seen.add(web.uri);
    out.push({ uri: web.uri, title: web.title ?? web.uri });
  }
  return out;
}

async function callOnce<T>(
  opts: GeminiJsonOptions<T>,
  client: GoogleGenAI,
  correction?: Correction,
): Promise<GeminiJsonResult<T>> {
  const tStart = Date.now();
  const log = opts.log ?? silentLogger;
  const config: Record<string, unknown> = {
    systemInstruction: opts.systemPrompt,
    maxOutputTokens: opts.maxTokens ?? 8192,
  };
  if (opts.useGrounding) {
    config.tools = [{ googleSearch: {} }];
  } else {
    // Only safe to pin JSON mime when NOT grounding.
    config.responseMimeType = "application/json";
  }

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
    { role: "user", parts: [{ text: opts.userPrompt }] },
  ];
  if (correction) {
    contents.push({ role: "model", parts: [{ text: correction.badText.slice(0, 8000) }] });
    contents.push({ role: "user", parts: [{ text: buildSchemaCorrection(correction.reason) }] });
  }

  const response = await generateWithBackoff(
    client,
    { model: opts.model, contents, config },
    log,
    opts.context,
  );

  // Read token usage once here: this was a 200 response, so it is billed and its
  // tokens must be reported even when the body is empty or then fails validation.
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? null;
  const outputTokens = usage?.candidatesTokenCount ?? null;

  const text = (response.text ?? "").trim();
  if (!text) {
    return {
      ok: false,
      reason: "Gemini returned no text content",
      durationMs: Date.now() - tStart,
      billed: true,
      inputTokens,
      outputTokens,
    };
  }

  const candidate = response.candidates?.[0];
  const gm = candidate?.groundingMetadata as Record<string, unknown> | undefined;
  const webSearchQueries = gm?.["webSearchQueries"];
  const searchCallCount = Array.isArray(webSearchQueries) ? webSearchQueries.length : 0;
  const groundingChunks = extractGroundingUrls(candidate?.groundingMetadata?.groundingChunks);

  const validated = parseAndValidate(opts.schema, text);
  if (!validated.ok) {
    log.warn({ ctx: opts.context, reason: validated.reason }, "Gemini output rejected");
    return {
      ok: false,
      reason: validated.reason,
      durationMs: Date.now() - tStart,
      rawText: text,
      billed: true,
      inputTokens,
      outputTokens,
      searchCallCount,
    };
  }
  return {
    ok: true,
    value: validated.value,
    durationMs: Date.now() - tStart,
    model: opts.model,
    inputTokens,
    outputTokens,
    groundingChunks,
    searchCallCount,
  };
}

/**
 * Call Gemini for a JSON response with optional Google Search grounding,
 * validate against the schema, and retry once. When the first miss is a
 * schema/parse failure the retry is informed: the model receives its own
 * rejected output and the validation error and is asked to correct it. Never
 * throws.
 */
export async function callGeminiJson<T>(opts: GeminiJsonOptions<T>): Promise<GeminiJsonResult<T>> {
  const client = getClient();
  if (!client) {
    return { ok: false, reason: "Gemini AI integration env not configured", durationMs: 0 };
  }
  const log = opts.log ?? silentLogger;
  let correction: Correction | undefined;
  let last: GeminiJsonResult<T> = { ok: false, reason: "no attempt made", durationMs: 0 };
  // Accumulate the real tokens across both attempts: a first attempt that fails
  // schema validation still billed its tokens, so the row recorded for this call
  // must carry the SUM of every billed attempt, never just the final one.
  const acc = { input: 0, output: 0, search: 0 };
  let anyBilled = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      last = await callOnce(opts, client, correction);
    } catch (e) {
      last = { ok: false, reason: e instanceof Error ? e.message : String(e), durationMs: 0 };
    }
    const billed = last.ok ? true : last.billed === true;
    if (billed) {
      anyBilled = true;
      acc.input += last.inputTokens ?? 0;
      acc.output += last.outputTokens ?? 0;
      acc.search += last.searchCallCount ?? 0;
    }
    if (last.ok) {
      return { ...last, inputTokens: acc.input, outputTokens: acc.output, searchCallCount: acc.search };
    }
    if (attempt === 0) {
      log.info({ ctx: opts.context, attempt: 1, reason: last.reason }, "Gemini call retrying");
      // Only a validation miss carries rawText; feed it back so the retry is
      // corrective. Transient SDK errors retry with the original prompt.
      correction = last.rawText ? { badText: last.rawText, reason: last.reason } : undefined;
    }
  }
  // Both attempts failed. If any consumed tokens, surface the summed real spend
  // and mark it billed so the ledger records the loss honestly; otherwise the
  // failure was a no-call and stays unbilled.
  if (anyBilled) {
    return { ...last, billed: true, inputTokens: acc.input, outputTokens: acc.output, searchCallCount: acc.search };
  }
  return last;
}
