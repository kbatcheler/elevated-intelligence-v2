import { z } from "zod/v4";

// The uniform connector contract from the Connectors and SOC 2 spec, native
// from foundations so every future ingestion path has its contract waiting.
//
// The governing principle is derive and discard: we touch client data, derive
// insight from it, and discard it. Our store holds math, not their records. A
// DerivedSignalSet therefore carries only non-reversible derived values:
// scores, ratios, distributions, counts, aggregates over a window, trend
// deltas, and non-reversible embeddings. It must never carry raw rows, names,
// account numbers, emails, free-text records, or anything reversible into a
// person or account.
//
// Enforcement is twofold: a Zod schema that rejects fields outside the allowed
// shape (strict objects, numeric-only values), and the assertDerivedSignalSet
// guard that fails the run if a connector tries to return raw content.

export const SIGNAL_KINDS = [
  "score",
  "ratio",
  "distribution",
  "count",
  "aggregate",
  "trend_delta",
  "embedding",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

// Vector kinds carry a numeric array; every other kind carries a single number.
const VECTOR_KINDS: ReadonlySet<SignalKind> = new Set(["distribution", "embedding"]);

const finiteNumber = z.number().finite();
const numericVector = z.array(finiteNumber).min(1).max(4096);

// A single derived signal. The object is strict, so any unexpected key (the
// vector for raw content to sneak in) is rejected. The value is constrained to
// a finite number or a numeric array, so no string, name or free-text record
// can ever be carried here.
export const derivedSignalSchema = z
  .strictObject({
    // A non-identifying metric key, for example "gross_margin_pct".
    key: z.string().min(1).max(120),
    kind: z.enum(SIGNAL_KINDS),
    value: z.union([finiteNumber, numericVector]),
    // Optional non-identifying metadata.
    window: z.string().min(1).max(60).optional(),
    unit: z.string().max(40).optional(),
  })
  .superRefine((sig, ctx) => {
    const isVector = VECTOR_KINDS.has(sig.kind);
    if (isVector && !Array.isArray(sig.value)) {
      ctx.addIssue({
        code: "custom",
        message: sig.kind + " requires a numeric array value",
        path: ["value"],
      });
    }
    if (!isVector && Array.isArray(sig.value)) {
      ctx.addIssue({
        code: "custom",
        message: sig.kind + " requires a scalar numeric value",
        path: ["value"],
      });
    }
  });

export type DerivedSignal = z.infer<typeof derivedSignalSchema>;

export const derivedSignalSetSchema = z.strictObject({
  // The connector kind that produced the set, for example "quickbooks". Non
  // identifying.
  source: z.string().min(1).max(80),
  tenantId: z.string().uuid(),
  // ISO 8601 timestamp of derivation.
  generatedAt: z.string().min(1).max(40),
  windowStart: z.string().min(1).max(40).optional(),
  windowEnd: z.string().min(1).max(40).optional(),
  signals: z.array(derivedSignalSchema).max(5000),
});

export type DerivedSignalSet = z.infer<typeof derivedSignalSetSchema>;

/**
 * Runtime guard for the connector boundary. Returns the parsed, validated set
 * or throws with a precise reason. Call this in extractSignals so a connector
 * that tries to return raw content fails the run loudly instead of silently
 * persisting reversible data.
 */
export function assertDerivedSignalSet(input: unknown): DerivedSignalSet {
  const result = derivedSignalSetSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => (i.path.length ? i.path.join(".") + ": " : "") + i.message)
      .join("; ");
    throw new Error("DerivedSignalSet rejected (derive-and-discard violation): " + detail);
  }
  return result.data;
}

export function isDerivedSignalSet(input: unknown): input is DerivedSignalSet {
  return derivedSignalSetSchema.safeParse(input).success;
}
