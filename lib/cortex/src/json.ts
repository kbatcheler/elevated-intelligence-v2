// Defensive JSON extraction for model output. Grounded Gemini calls cannot be
// pinned to a JSON response mime type (the Google Search tool forbids it), so
// the engine relies on prompt discipline plus this extractor: strip any code
// fence, fall back to the largest balanced brace span, parse, then validate
// against a Zod schema. The model clients call parseAndValidate twice (one
// retry) before giving up.

import { z, type ZodType } from "zod/v4";

export function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// Extract the largest balanced {...} span. Handles models that wrap JSON in
// prose ("Here is the JSON: { ... }. Hope this helps."). Returns null when no
// plausible object span exists.
export function extractJsonObject(text: string): string | null {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  return text.slice(first, last + 1);
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; reason: string };

// Parse model text into a value: try the fenced/stripped form first, then the
// brace-extracted substring. Never throws.
export function parseJsonLoose(text: string): ParseResult {
  const cleaned = stripJsonFence(text);
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    const span = extractJsonObject(cleaned);
    if (span === null) {
      return { ok: false, reason: "no JSON object found in model output" };
    }
    try {
      return { ok: true, value: JSON.parse(span) };
    } catch (e) {
      return { ok: false, reason: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

// Build the corrective follow-up message fed back to a model after its previous
// answer failed schema validation. The model sees its own bad output plus this
// instruction, so the retry is informed rather than a blind re-roll.
export function buildSchemaCorrection(reason: string): string {
  return [
    "Your previous response did not satisfy the required schema.",
    `Validation error: ${reason}`,
    "Return a corrected JSON object that fixes exactly these problems and matches",
    "the schema. Output ONLY the JSON object: no prose, no explanation, no code fence.",
  ].join("\n");
}

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; reason: string };

// Parse then validate against a schema. Returns a short, readable reason on
// failure so the pipeline can log it and fall back.
export function parseAndValidate<T>(schema: ZodType<T>, text: string): ValidateResult<T> {
  const parsed = parseJsonLoose(text);
  if (!parsed.ok) return parsed;
  const result = schema.safeParse(parsed.value);
  if (!result.success) {
    return { ok: false, reason: `schema validation failed: ${z.prettifyError(result.error).slice(0, 400)}` };
  }
  return { ok: true, value: result.data };
}
