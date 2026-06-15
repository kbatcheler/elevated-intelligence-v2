import express, { Router } from "express";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { isProvider } from "../lib/auth/access";
import { ingestDerivedSignalSet } from "../lib/ingestion/ingestCore";
import { assertIngestibleLayer, IngestionLayerError } from "../lib/ingestion/layers";
import { deriveUpload, MAX_UPLOAD_BYTES, UploadError } from "../lib/ingestion/uploadDerive";

// Manual upload (Phase AE, ingestion path 3). A provider uploads a spreadsheet or
// a contract document against a tenant and a target layer. The bytes arrive as
// the raw request body (no multipart dependency); the filename and layer travel
// as query parameters. The file is parsed and derived in memory, the math is
// persisted through the shared ingestion terminus, and the bytes are discarded
// when this handler returns: nothing here ever writes the artifact to disk or to
// the database. The response shows the operator exactly what was derived and what
// was discarded, which is itself the trust feature.
export const uploadRouter = Router();

// A small margin above the logical 10MB cap so deriveUpload returns the precise
// file_too_large error rather than express throwing an opaque payload error.
const rawBody = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 * 1024 });

uploadRouter.post("/tenants/:id/uploads", rawBody, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!isProvider(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const tenantId = String(req.params.id);
    const tenant = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant[0]) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const layer = String(req.query.layer ?? "");
    const filename = String(req.query.filename ?? req.header("x-filename") ?? "");
    if (layer === "" || filename === "") {
      res.status(400).json({ error: "missing_layer_or_filename" });
      return;
    }
    try {
      await assertIngestibleLayer(tenantId, layer);
    } catch (err) {
      if (err instanceof IngestionLayerError) {
        res.status(400).json({ error: err.code, detail: err.message });
        return;
      }
      throw err;
    }

    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mime = req.header("content-type") ?? "";

    let derivation;
    try {
      derivation = await deriveUpload({ filename, mime, bytes, targetLayer: layer });
    } catch (err) {
      if (err instanceof UploadError) {
        res.status(err.status).json({ error: err.code, detail: err.message });
        return;
      }
      throw err;
    }

    let result;
    try {
      result = await ingestDerivedSignalSet({
        tenantId,
        method: "upload",
        feedKey: layer,
        layers: [layer],
        signals: derivation.signals,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid signal set";
      if (/derive|signal|numeric|raw|strict|expected/i.test(message)) {
        res.status(400).json({ error: "invalid_signals", detail: message });
        return;
      }
      throw err;
    }

    res.status(201).json({
      accepted: true,
      fileType: derivation.fileType,
      kind: derivation.kind,
      layer,
      rootHash: result.rootHash,
      signalsCount: result.signalsCount,
      derived: derivation.derivedSummary,
      discarded: derivation.discarded,
    });
  } catch (err) {
    next(err);
  }
});
