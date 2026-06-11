// Shared schema primitives for the stage and content schemas. Strings are
// clamped before validation so an occasional model overshoot is truncated to
// the bound rather than failing a whole layer. This keeps the persisted JSONB
// payloads bounded (the columns are untyped jsonb).

import { z } from "zod/v4";

// Clamp any input string to `max` characters BEFORE validation; apply `min`
// (when > 0) to the truncated string so genuinely empty output still fails. A
// model often returns a bare number or boolean where a string is wanted (e.g. a
// metric value of 12), so coerce those scalars rather than failing the layer.
export const clampedStr = (max: number, min = 0) =>
  z.preprocess(
    (v) => {
      if (typeof v === "string") return v.slice(0, max);
      if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v).slice(0, max);
      return v;
    },
    min > 0 ? z.string().min(min) : z.string(),
  );

// Coerce one array item to a string. Models frequently return an array of
// objects ({ name, type }) where the schema wants plain names; pull the most
// name-like field, else join the string values, else stringify. Keeps a shape
// slip from failing a whole stage.
function itemToString(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "number" || typeof item === "bigint" || typeof item === "boolean") return String(item);
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    for (const k of ["name", "label", "entity", "title", "text", "value"]) {
      if (typeof o[k] === "string" && o[k]) return o[k] as string;
    }
    const vals = Object.values(o).filter((x): x is string => typeof x === "string" && x.length > 0);
    if (vals.length) return vals.join(": ");
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  }
  return String(item ?? "");
}

// Normalise a value the model may have returned as a single item, null, or an
// array into an array.
function toArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// An array-of-strings field that tolerates the model returning objects or a
// single value, and slices to `maxItems` rather than rejecting an overshoot.
// Always yields an array (empty when absent), so `.optional()` is unnecessary.
export const looseStringArray = (max: number, maxItems: number) =>
  z.preprocess((v) => toArray(v).map(itemToString).slice(0, maxItems), z.array(clampedStr(max)).max(maxItems));

// An array of structured items that tolerates the model overshooting the cap:
// slice to `max` rather than rejecting, the way clampedStr truncates a string.
// A single object is wrapped into a one-item array; `min` still enforces a floor
// so a genuinely missing required list still fails.
export const cappedArray = <T extends z.ZodTypeAny>(item: T, min: number, max: number) =>
  z.preprocess(
    (v) => toArray(v).slice(0, max),
    min > 0 ? z.array(item).min(min).max(max) : z.array(item).max(max),
  );

export const toneEnum = z.enum(["good", "warn", "bad", "neutral"]);
export const gapKindEnum = z.enum(["DATA", "SIGNAL", "INTEG", "MODEL", "FLOW"]);

// Evidence basis used inside intermediate stage outputs (draft annotations).
export const evidenceTypeEnum = z.enum(["grounded", "inferred"]);
export type EvidenceType = z.infer<typeof evidenceTypeEnum>;

// Final per-claim basis written by the Evaluator (score) into stored content.
export const basisEnum = z.enum(["verified", "modelled"]);
export type Basis = z.infer<typeof basisEnum>;

export const urlString = z.string().min(1).max(800);

// Pull a URL out of a string or an object the model wrapped it in
// ({ url } / { uri } / { source }), dropping anything URL-less.
function urlItem(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    for (const k of ["url", "uri", "link", "href", "source"]) {
      if (typeof o[k] === "string" && o[k]) return o[k] as string;
    }
  }
  return null;
}
function coerceUrlList(v: unknown): string[] {
  return toArray(v)
    .map(urlItem)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
}

// Optional list of source URLs (empty when absent). Tolerates objects + a
// single value, and slices to 8 rather than rejecting: grounded seats routinely
// cite far more sources than a layer needs to persist.
export const urlArray = z.preprocess((v) => coerceUrlList(v).slice(0, 8), z.array(urlString).max(8));
// Same, but at least one URL is required (a verified claim must cite).
export const requiredUrlArray = z.preprocess((v) => coerceUrlList(v).slice(0, 8), z.array(urlString).min(1).max(8));

export const gapSchema = z.object({
  kind: gapKindEnum,
  description: clampedStr(600),
  closes: clampedStr(400).optional(),
  // Confidence lift, in percentage points, from closing this gap. Filled by
  // the score stage; defaults to 0 for pre-score gaps.
  confidence_lift_pp: z.number().min(0).max(50).optional().default(0),
});
export type Gap = z.infer<typeof gapSchema>;
