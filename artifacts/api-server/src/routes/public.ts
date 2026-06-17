import { Router, type Request, type Response, type NextFunction } from "express";
import { createRateLimiter } from "../middleware/rateLimit";
import { requireDiagnosisShareToken } from "../middleware/shareToken";
import { loadTenantOverview } from "../lib/overview/overview";
import { toPublicDiagnosisLayer } from "../lib/overview/overviewProjection";
import { loadCaseStudyForTenant } from "../lib/sellability/caseStudies";

// The ONLY unauthenticated data surface (Phase AB). A cold prospect opens a
// shared link and gets a read-only, board-pack-level diagnosis with no session,
// no cookie, and no access to the full causes/proof, raw connector data,
// provenance, or any identity. The token middleware fences it to one tenant; the
// projection narrows each layer to its public shape; a per-IP rate limit blunts
// scraping of the public endpoint.
export const publicRouter: Router = Router();

// A deliberately tight limit: a human opening a link refreshes a handful of
// times, a scraper hammers it. Keyed by client IP, which is trustworthy here
// because the app sets "trust proxy" in front of the dev proxy.
const diagnosisRateLimit = createRateLimiter({
  name: "public-diagnosis",
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => req.ip ?? "unknown",
});

// The viral mark every shared diagnosis carries. A brand attribution, not a
// figure: it is a constant, never computed from state. The href is relative so
// the portal composes it against its own origin.
const POWERED_BY = { label: "Powered by Elevated Intelligence", href: "/" } as const;

publicRouter.get(
  "/diagnosis/:token",
  diagnosisRateLimit,
  requireDiagnosisShareToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // requireDiagnosisShareToken guarantees this is set; the guard keeps the
      // type honest rather than asserting non-null.
      const tenantId = req.shareTenantId;
      if (!tenantId) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const overview = await loadTenantOverview(tenantId);
      const caseStudy = await loadCaseStudyForTenant(tenantId);
      res.json({
        diagnosis: {
          layers: overview.map(toPublicDiagnosisLayer),
          caseStudy,
          poweredBy: POWERED_BY,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
