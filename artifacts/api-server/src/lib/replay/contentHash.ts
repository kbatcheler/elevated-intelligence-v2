import { createHash } from "node:crypto";

// Stable, deterministic JSON serialisation: object keys are emitted in sorted
// order at every depth, so two structurally-equal values always produce the same
// bytes regardless of key insertion order. Arrays keep their order (order is
// meaningful in a diagnosis). Used only for hashing and equality, never for
// display.
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

// The diagnosis content payload that defines whether two builds said the same
// thing. It is the model output (content, hero, benchmark, supplements,
// confounders, the verified/modelled claim split), our deterministic voice
// measurement, and the build-mode flag (a reduced express build is a materially
// different diagnosis from a full one). generatorModel and rawConfidence are
// deliberately excluded: the as-of diff surfaces those on their own.
export interface HashableLayerContent {
  content: unknown;
  heroPanel: unknown;
  peerBenchmark: unknown;
  supplementBlocks: unknown;
  confounders: unknown;
  verifiedClaims: unknown;
  modelledClaims: unknown;
  voiceQuality: unknown;
  reducedMode: boolean;
}

// The fingerprint the as-of "what changed since" diff compares: a sha256 over the
// canonical bytes of the content payload. An unchanged build hashes equal; any
// real change does not. Nullable fields are normalised to null so a missing and
// an explicitly-null field hash identically.
export function hashLayerContent(c: HashableLayerContent): string {
  const canonical = canonicalStringify({
    content: c.content ?? null,
    heroPanel: c.heroPanel ?? null,
    peerBenchmark: c.peerBenchmark ?? null,
    supplementBlocks: c.supplementBlocks ?? null,
    confounders: c.confounders ?? null,
    verifiedClaims: c.verifiedClaims ?? null,
    modelledClaims: c.modelledClaims ?? null,
    voiceQuality: c.voiceQuality ?? null,
    reducedMode: c.reducedMode,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
