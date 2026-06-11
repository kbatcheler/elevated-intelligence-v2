// Anthropic client for the reasoner (Sonnet) and evaluator (Haiku) seats,
// hitting the Replit AI Integrations managed proxy with a raw fetch. The model
// is always supplied by the caller from CORTEX config; this file holds no model
// identifier. perceive enables the server-side web_search tool; the wrapper
// walks the response blocks to surface consulted URLs and the search count.
//
// Reliability: an inner loop honours a 429 Retry-After header (up to 4
// sub-attempts), and one outer self-correcting retry feeds the model its own
// rejected output plus the schema error so it can fix a parse/validation miss.

import { type ZodType } from "zod/v4";
import { buildSchemaCorrection, parseAndValidate } from "../json";
import { silentLogger, type Logger } from "../logger";

const WEB_SEARCH_TOOL = { type: "web_search_20250305" as const, name: "web_search" as const };

// A single system block. `cache: true` adds an Anthropic ephemeral cache marker
// so this block and everything before it is cached for a few minutes.
export type SystemBlock = { text: string; cache?: boolean };

export type AnthropicCallOptions<T> = {
  model: string;
  system: string | SystemBlock[];
  user: string;
  schema: ZodType<T>;
  maxTokens?: number;
  useWebSearch?: boolean;
  log?: Logger;
  context?: string;
};

export type AnthropicResult<T> =
  | {
      ok: true;
      value: T;
      durationMs: number;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      consultedUrls: string[];
      searchCallCount: number;
    }
  | { ok: false; reason: string; durationMs: number; rawText?: string };

// The model's own rejected output and the schema error, fed back on retry.
type Correction = { badText: string; reason: string };

function getEnv(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

function buildSystemPayload(
  system: string | SystemBlock[],
): string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  if (typeof system === "string") return system;
  return system.map((b) =>
    b.cache
      ? { type: "text" as const, text: b.text, cache_control: { type: "ephemeral" as const } }
      : { type: "text" as const, text: b.text },
  );
}

type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "server_tool_use"; name?: string }
  | { type: "web_search_tool_result"; content?: Array<{ url?: string }> }
  | { type: string; [k: string]: unknown };

function walkContent(blocks: ContentBlock[] | undefined): {
  text: string;
  consultedUrls: string[];
  searchBlockCount: number;
} {
  if (!blocks?.length) return { text: "", consultedUrls: [], searchBlockCount: 0 };
  let lastText = "";
  let searchBlockCount = 0;
  const urls = new Set<string>();
  for (const b of blocks) {
    if (b.type === "text" && typeof (b as { text?: string }).text === "string") {
      lastText = (b as { text?: string }).text ?? lastText;
    } else if (b.type === "server_tool_use" && (b as { name?: string }).name === "web_search") {
      searchBlockCount += 1;
    } else if (b.type === "web_search_tool_result") {
      const raw = (b as { content?: unknown }).content;
      if (Array.isArray(raw)) {
        for (const item of raw as Array<{ url?: string }>) {
          if (item && typeof item.url === "string" && item.url) urls.add(item.url);
        }
      }
    }
  }
  return { text: lastText, consultedUrls: Array.from(urls), searchBlockCount };
}

async function callOnce<T>(
  opts: AnthropicCallOptions<T>,
  env: { baseUrl: string; apiKey: string },
  correction?: Correction,
): Promise<AnthropicResult<T>> {
  const tStart = Date.now();
  const log = opts.log ?? silentLogger;
  const model = opts.model;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "user", content: opts.user }];
  if (correction) {
    messages.push({ role: "assistant", content: correction.badText.slice(0, 8000) });
    messages.push({ role: "user", content: buildSchemaCorrection(correction.reason) });
  }
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 8192,
    system: buildSystemPayload(opts.system),
    messages,
  };
  if (opts.useWebSearch) {
    body.tools = [WEB_SEARCH_TOOL];
  }

  // Inner loop: respect Retry-After on 429s, up to 4 sub-attempts.
  let apiRes: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    apiRes = await fetch(`${env.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": env.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (apiRes.status !== 429) break;
    const ra = Number(apiRes.headers.get("retry-after"));
    const waitMs = Math.min(45_000, (Number.isFinite(ra) && ra > 0 ? ra : 5 + attempt * 5) * 1000);
    log.warn({ ctx: opts.context, attempt, waitMs }, "Anthropic 429, backing off");
    await apiRes.text().catch(() => undefined);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (!apiRes || !apiRes.ok) {
    const status = apiRes?.status ?? 0;
    const errBody = apiRes ? await apiRes.text().catch(() => "") : "";
    log.error({ ctx: opts.context, status, body: errBody.slice(0, 300) }, "Anthropic call non-2xx");
    return { ok: false, reason: `Anthropic HTTP ${status}`, durationMs: Date.now() - tStart };
  }

  const payload = (await apiRes.json()) as {
    content?: ContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      server_tool_use?: { web_search_requests?: number };
    };
    model?: string;
  };
  const { text, consultedUrls, searchBlockCount } = walkContent(payload.content);
  if (!text) {
    return { ok: false, reason: "Anthropic returned no text content", durationMs: Date.now() - tStart };
  }
  // Prefer the usage-reported search count; fall back to counting blocks.
  const searchCallCount = payload.usage?.server_tool_use?.web_search_requests ?? searchBlockCount;

  const validated = parseAndValidate(opts.schema, text);
  if (!validated.ok) {
    log.warn({ ctx: opts.context, reason: validated.reason }, "Anthropic output rejected");
    return { ok: false, reason: validated.reason, durationMs: Date.now() - tStart, rawText: text };
  }
  return {
    ok: true,
    value: validated.value,
    durationMs: Date.now() - tStart,
    model: payload.model ?? model,
    inputTokens: payload.usage?.input_tokens ?? null,
    outputTokens: payload.usage?.output_tokens ?? null,
    consultedUrls,
    searchCallCount,
  };
}

/**
 * Call Claude with strict JSON output, validate against the schema, and retry
 * once. When the first miss is a schema/parse failure the retry is informed:
 * the model receives its own rejected output and the validation error and is
 * asked to correct it. Never throws.
 */
export async function callClaudeJson<T>(opts: AnthropicCallOptions<T>): Promise<AnthropicResult<T>> {
  const env = getEnv();
  if (!env) {
    return { ok: false, reason: "Anthropic AI integration env not configured", durationMs: 0 };
  }
  const log = opts.log ?? silentLogger;
  let correction: Correction | undefined;
  let last: AnthropicResult<T> = { ok: false, reason: "no attempt made", durationMs: 0 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    last = await callOnce(opts, env, correction);
    if (last.ok) return last;
    if (attempt === 0) {
      log.info({ ctx: opts.context, attempt: 1, reason: last.reason }, "Anthropic call retrying");
      // Only a validation miss carries rawText; feed it back so the retry is
      // corrective. Transient HTTP errors retry with the original prompt.
      correction = last.rawText ? { badText: last.rawText, reason: last.reason } : undefined;
    }
  }
  return last;
}
