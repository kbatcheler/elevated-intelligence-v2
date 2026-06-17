import { Router } from "express";
import { z } from "zod/v4";
import { ingestDerivedSignalSet } from "../lib/ingestion/ingestCore";
import { assertIngestibleLayer, IngestionLayerError } from "../lib/ingestion/layers";
import { ingestionOpenApiDocument } from "../lib/ingestion/openapi";
import { requireIngestionKey } from "../middleware/ingestionAuth";
import { createRateLimiter } from "../middleware/rateLimit";

// The public Ingestion API (Phase AE). One layer per call: a client posts a set
// of derived numeric signals, the tenant is resolved from the bearer ingestion
// key, and the math flows through the one shared derive-and-discard path. The
// request body is derived math by contract; no raw artifact is stored.
export const ingestRouter = Router();

// OpenAPI discovery is public so a client can read the contract before it holds a
// key. It carries only the shape and the bearer requirement, never a secret.
ingestRouter.get("/openapi.json", (_req, res) => {
  res.json(ingestionOpenApiDocument());
});

// A per-key fixed-window limiter, keyed by the ingestion key id (falling back to
// the client ip before the key is resolved). Applied after the key gate so one
// tenant's volume cannot starve another's.
const ingestLimiter = createRateLimiter({
  name: "ingest",
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => req.ingestionKey?.id ?? req.ip ?? "unknown",
});

const ingestBodySchema = z.object({
  layer: z.string().min(1).max(120),
  signals: z.array(z.unknown()).max(5000),
  generatedAt: z.string().min(1).max(40).optional(),
  windowStart: z.string().min(1).max(40).optional(),
  windowEnd: z.string().min(1).max(40).optional(),
});

ingestRouter.post("/", requireIngestionKey, ingestLimiter, async (req, res, next) => {
  try {
    const tenantId = req.ingestionKey!.tenantId;
    const parsed = ingestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_request", detail: parsed.error.issues[0]?.message });
      return;
    }
    const body = parsed.data;

    try {
      await assertIngestibleLayer(tenantId, body.layer);
    } catch (err) {
      if (err instanceof IngestionLayerError) {
        res.status(400).json({ error: err.code, layer: body.layer });
        return;
      }
      throw err;
    }

    let result;
    try {
      result = await ingestDerivedSignalSet({
        tenantId,
        method: "api",
        feedKey: body.layer,
        layers: [body.layer],
        signals: body.signals,
        generatedAt: body.generatedAt,
        windowStart: body.windowStart,
        windowEnd: body.windowEnd,
      });
    } catch (err) {
      // assertDerivedSignalSet (inside the shared persist path) throws on raw or
      // non-numeric content. Map that to a precise 400 rather than a 500, so a
      // client that posts records instead of math learns exactly why.
      const message = err instanceof Error ? err.message : "invalid signal set";
      if (/derive|signal|numeric|raw|strict|expected/i.test(message)) {
        res.status(400).json({ error: "invalid_signals", detail: message });
        return;
      }
      throw err;
    }

    res.status(202).json({
      accepted: true,
      rootHash: result.rootHash,
      signalsCount: result.signalsCount,
      layers: result.layers,
    });
  } catch (err) {
    next(err);
  }
});
