import { appendEntry } from "../provenance/ledger";
import { persistDerivedSignalSet } from "../connectors/persistSignals";

// The shared terminus for every ingestion path (Phase AE). API, webhook, manual
// upload, SFTP drop, and MCP each parse and derive in memory, then hand only a
// DerivedSignalSet of numeric math here. This module never receives or stores a
// raw artifact: the file bytes, event payload, or request body are discarded by
// the caller before this runs. From here the math flows through the one shared
// persistence path (delete-prior + insert, per-tenant encryption) exactly like a
// connector refresh, so every ingested signal passes the same numeric-only guard
// and the same supersede semantics, and the provenance ledger records the
// ingestion method that produced it.

export const INGESTION_METHODS = ["api", "webhook", "upload", "sftp", "mcp"] as const;
export type IngestionMethod = (typeof INGESTION_METHODS)[number];

// The derived_signals.sourceConnectorKey namespace for an ingestion feed. The
// feedKey is the layer key for the single-layer paths (api, upload, sftp, mcp)
// and the stable webhook source id for webhooks, so each logical feed supersedes
// only its own prior set and never clobbers another feed's grounding of a layer.
export function ingestionSource(method: IngestionMethod, feedKey: string): string {
  return "ingest:" + method + ":" + feedKey;
}

export interface IngestArgs {
  tenantId: string;
  method: IngestionMethod;
  feedKey: string;
  layers: string[];
  // Untrusted derived math. assertDerivedSignalSet (inside persist) rejects any
  // raw or non-numeric content loudly before a write reaches the store.
  signals: unknown;
  generatedAt?: string;
  windowStart?: string;
  windowEnd?: string;
  computedAt?: Date;
}

export interface IngestResult {
  signalsCount: number;
  rowsWritten: number;
  rootHash: string;
  source: string;
  layers: string[];
}

// A short, non-identifying metric token: it must start alphanumeric and may then
// carry only letters, digits, and the metric punctuation "." "_" ":" "%" "$" "/"
// "+" "-". This deliberately excludes whitespace, "@", and control characters, so
// a key/window/unit can name a metric ("gross_margin_pct", "events_per_min") but
// can never carry free text, an email, or other identifying content.
const METADATA_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:%$\/+-]*$/;

function checkMetadataToken(field: string, value: unknown, max: number): void {
  if (value === undefined || value === null) return;
  // A non-string here is a shape error; the schema in persist rejects it
  // precisely, so this guard concerns itself only with identifying STRING content.
  if (typeof value !== "string") return;
  if (value.length > max || !METADATA_TOKEN.test(value)) {
    throw new Error(
      "ingested signal metadata rejected (derive-and-discard boundary): the " +
        field +
        " must be a short non-identifying token (letters, digits, and . _ : % $ / + - only)," +
        " never free text or identifying content",
    );
  }
}

// Enforce, at the ingestion boundary, that the caller-supplied metric metadata
// (key, window, unit) on every signal is a non-identifying token. Connectors are
// first-party and emit clean keys, so the shared contract schema stays permissive
// for them; the five ingestion paths take untrusted external input, so the
// stricter check lives here, the single terminus they all pass through. A
// violation throws with a message the routes map to a precise 400 rather than a
// 500. Shape errors (a non-array, a non-object signal) are left to the schema.
function assertNonIdentifyingMetadata(signals: unknown): void {
  if (!Array.isArray(signals)) return;
  for (const item of signals) {
    if (item === null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    checkMetadataToken("key", rec.key, 120);
    checkMetadataToken("window", rec.window, 60);
    checkMetadataToken("unit", rec.unit, 40);
  }
}

export async function ingestDerivedSignalSet(args: IngestArgs): Promise<IngestResult> {
  if (args.layers.length === 0) {
    throw new Error("ingestion requires at least one target layer");
  }
  assertNonIdentifyingMetadata(args.signals);
  const source = ingestionSource(args.method, args.feedKey);
  const set: Record<string, unknown> = {
    source,
    tenantId: args.tenantId,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    signals: args.signals,
  };
  if (args.windowStart) set.windowStart = args.windowStart;
  if (args.windowEnd) set.windowEnd = args.windowEnd;

  const result = await persistDerivedSignalSet({
    tenantId: args.tenantId,
    connectorKey: source,
    set,
    layers: args.layers,
    computedAt: args.computedAt,
  });

  // Append one provenance entry per layer, anchored to the derived root hash and
  // tagging the ingestion method in the claim path. The hash is over the math
  // only, never the raw artifact, so the chain proves what was derived without
  // ever holding what it was derived from.
  for (const layer of args.layers) {
    await appendEntry({
      tenantId: args.tenantId,
      claimPath: "ingestion:" + args.method + ":" + layer,
      sourceRef: result.rootHash,
    });
  }

  return {
    signalsCount: result.signalsCount,
    rowsWritten: result.rowsWritten,
    rootHash: result.rootHash,
    source,
    layers: args.layers,
  };
}
