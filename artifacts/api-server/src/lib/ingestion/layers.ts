import { and, eq } from "drizzle-orm";
import { db, layersTable, tenantLayerConfigTable } from "@workspace/db";

// A target layer named by an ingestion path is untrusted input. It must name a
// real registry layer (canonical or custom) and must not be disabled for this
// tenant. The registry is the single source of truth for layer identity, so we
// check it rather than any hardcoded list. A bad layer is a precise, loud 400 at
// the route, never a silent write under an unknown key.
export type IngestionLayerErrorCode = "unknown_layer" | "disabled_layer";

export class IngestionLayerError extends Error {
  readonly code: IngestionLayerErrorCode;
  constructor(code: IngestionLayerErrorCode, layerKey: string) {
    super(code + ": " + layerKey);
    this.name = "IngestionLayerError";
    this.code = code;
  }
}

export async function assertIngestibleLayer(tenantId: string, layerKey: string): Promise<string> {
  const known = await db
    .select({ key: layersTable.key })
    .from(layersTable)
    .where(eq(layersTable.key, layerKey))
    .limit(1);
  if (known.length === 0) {
    throw new IngestionLayerError("unknown_layer", layerKey);
  }
  const cfg = await db
    .select({ enabled: tenantLayerConfigTable.enabled })
    .from(tenantLayerConfigTable)
    .where(
      and(
        eq(tenantLayerConfigTable.tenantId, tenantId),
        eq(tenantLayerConfigTable.layerKey, layerKey),
      ),
    )
    .limit(1);
  if (cfg.length > 0 && cfg[0]!.enabled === false) {
    throw new IngestionLayerError("disabled_layer", layerKey);
  }
  return layerKey;
}
