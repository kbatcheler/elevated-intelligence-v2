import type { NextFunction, Request, Response } from "express";
import type { DiagnosisSharePrivacy } from "@workspace/db";
import { resolveShareToken } from "../lib/sellability/shareTokens";

// The public shareable diagnosis (Phase AB) is gated by an opaque token, never a
// user session. This middleware hashes the presented token, resolves the one
// unexpired, unrevoked share, records its access telemetry, and attaches ONLY the
// tenant id and privacy posture to the request. Any miss (unknown, expired, or
// revoked) returns a uniform 404, so a probe cannot distinguish the three cases.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      shareTenantId?: string;
      sharePrivacy?: DiagnosisSharePrivacy;
    }
  }
}

export async function requireDiagnosisShareToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = String(req.params.token ?? "");
    if (token.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const resolved = await resolveShareToken(token);
    if (!resolved) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    req.shareTenantId = resolved.tenantId;
    req.sharePrivacy = resolved.privacyLevel;
    next();
  } catch (err) {
    next(err);
  }
}
