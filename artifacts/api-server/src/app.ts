import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { logger } from "./lib/logger";
import { requireAuth, requireOwner } from "./middleware/auth";
import { adminRouter } from "./routes/admin";
import { architectureRouter } from "./routes/architecture";
import { agentRouter } from "./routes/agent";
import { authRouter } from "./routes/auth";
import { backupsRouter } from "./routes/backups";
import { benchmarksRouter } from "./routes/benchmarks";
import { clientRouter } from "./routes/client";
import { captureError } from "./lib/observability/sentryReporter";
import { redactRoute } from "./lib/observability/redactRoute";
import { healthRouter } from "./routes/health";
import { ingestRouter } from "./routes/ingest";
import { mcpRouter } from "./routes/mcp";
import { ingestionAdminRouter } from "./routes/ingestionAdmin";
import { layersRouter } from "./routes/layers";
import { operationsRouter } from "./routes/operations";
import { portfolioRouter } from "./routes/portfolio";
import { publicRouter } from "./routes/public";
import { uploadRouter } from "./routes/upload";
import { webhookRouter } from "./routes/webhooks";
import { pushRouter } from "./routes/push";
import { retentionRouter } from "./routes/retention";
import { securityRouter } from "./routes/security";
import { sellabilityRouter } from "./routes/sellability";
import { spendRouter } from "./routes/spend";
import { tenantsRouter } from "./routes/tenants";

const app = express();

// The portal reaches this server only through the vite dev proxy, which sits one
// hop in front. Trusting that single proxy lets req.ip resolve to the real
// client for the rate limiter and for any future per-IP logic.
app.set("trust proxy", 1);

// Auth is cookie-based and flows same-origin through the proxy, so the browser
// never makes a credentialed cross-origin call. CORS is therefore closed by
// default: no Access-Control-Allow-Origin is emitted unless an explicit
// allowlist is configured via CORS_ORIGINS, and credentials are never allowed
// cross-origin. This is a deliberate tightening from the prior wide-open cors().
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: false,
  }),
);

// The body limit is raised from the 100kb default to admit a full ingestion
// signal set (Phase AE) while still bounding an oversized post. The verify hook
// captures the exact raw bytes on req.rawBody so the webhook receiver can
// recompute its HMAC over the body the client signed, not a re-serialisation.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// Liveness, no auth.
app.use("/", healthRouter);

// Public auth surface: register and login are PIN/credential gated internally,
// status and logout are safe to call unauthenticated.
app.use("/api/auth", authRouter);

// Owner-only Access console API.
app.use("/api/admin", requireAuth, requireOwner, adminRouter);

// Owner-only cost and token observability (Phase N). Mounted with its own gate
// ahead of the shared session gate, like the admin console: spend is a provider-
// owner concern, never visible to a client or portfolio seat.
app.use("/api/spend", requireAuth, requireOwner, spendRouter);

// Owner-only Operations console API (Phase P). Same owner gate as spend: queue
// depth, in-flight runs, recent failures, and the alert feed are provider-owner
// concerns, never visible to a client or portfolio seat.
app.use("/api/operations", requireAuth, requireOwner, operationsRouter);

// Owner-only backups and disaster recovery API (Phase U). Same owner gate:
// triggering a ledger archive and reading the backup audit are provider-owner
// concerns, never visible to a client or portfolio seat.
app.use("/api/backups", requireAuth, requireOwner, backupsRouter);

// Owner-only benchmarking control API (Phase X). Triggering a recompute and
// reading the recompute audit are provider-owner concerns. The per-tenant consent
// routes live on the tenants router instead, fenced by requireTenantAccess, since
// changing a tenant's own participation is a tenant-scoped action.
app.use("/api/benchmarks", requireAuth, requireOwner, benchmarksRouter);

// The client-admin onboarding surface. requireAuth runs here; the router itself
// restricts every route to the client-admin role and forces the invite scope to
// the caller's own org and the client-viewer role, so a client-admin can onboard
// viewers into their own org and reach nothing on the provider side.
app.use("/api/client", requireAuth, clientRouter);

// The in-client extraction agent surface. Gated by its own per-tenant agent
// credential (inside agentRouter), not by a user session, so it is mounted ahead
// of the session gate below. It never trusts a proxy-injected client certificate
// header; the bearer credential is its sole trust root.
app.use("/api/agent", agentRouter);

// The public Ingestion API (Phase AE). Gated by its own per-tenant ingestion key
// inside the router (rate limited, tenant resolved from the key), NOT by a user
// session, so it is mounted ahead of the session gate below. Every payload is
// derived numeric math by contract; no raw artifact is persisted.
app.use("/v1/ingest", ingestRouter);

// The inbound webhook receiver (Phase AE). Public, gated only by a per-source
// HMAC over the raw body (verified inside the router), NOT by a user session, so
// it is mounted ahead of the session gate below. Mounted under /api/webhooks
// before the /api session gate so the more specific path wins. Every payload is
// derived numeric math; no raw artifact is persisted.
app.use("/api/webhooks", webhookRouter);

// The MCP server (Phase AE). Speaks JSON-RPC 2.0, gated by the same per-tenant
// ingestion key as the Ingestion API (verified inside the router), NOT by a user
// session, so it is mounted ahead of the session gate below. submit_signals
// writes through the shared derive-and-discard terminus; the read tools never
// fabricate a result.
app.use("/mcp", mcpRouter);

// The public, unauthenticated shareable diagnosis (Phase AB). Gated by an opaque
// share token inside the router (per-IP rate limited, token resolved to a single
// tenant, board-pack-level projection only), NOT by a user session, so it is
// mounted ahead of the session gate below. This is the only data surface that
// serves an unauthenticated read, and it never exposes connector data,
// provenance, the full causes/proof arrays, or any identity.
app.use("/api/public", publicRouter);

// Everything else under /api requires a valid, non-disabled session. requireAuth
// runs once here; the data routers follow. Per-tenant fencing is enforced inside
// the tenants router on the :id routes.
app.use("/api", requireAuth);
app.use("/api", layersRouter);
app.use("/api", architectureRouter);
app.use("/api", tenantsRouter);
// Ingestion suite admin console (Phase AE): mint/list/revoke per-tenant ingestion
// keys and webhook sources. Provider-only inside the router, behind this gate.
app.use("/api", ingestionAdminRouter);
app.use("/api", uploadRouter);
app.use("/api", securityRouter);
app.use("/api", retentionRouter);

// The Portfolio Intelligence view (Phase Y). Mounted under the shared session
// gate above; the router itself resolves scope from the session and refuses any
// non-portfolio, non-provider seat with 403 portfolio_only, so it needs no
// dedicated role gate here.
app.use("/api/portfolio", portfolioRouter);

// The Proactive Push Intelligence surface (Phase Z). Mounted under the shared
// session gate above; every route is per-user and double-fenced inside the router
// (ownerUserId = me AND tenant reachable), so it needs no dedicated role gate.
app.use("/api/push", pushRouter);

// The Sellability Pack authed surface (Phase AB). Mounted under the shared
// session gate above; every route additionally requires a provider seat (and the
// tenant routes per-tenant access) inside the router, since minting, revoking, and
// listing shares and reading the anonymized case studies are provider-side selling
// actions, never a client or portfolio concern.
app.use("/api", sellabilityRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error({ err: message }, "Request failed");
  // Phase P: capture the unhandled error to the aggregator. Fire-and-forget and
  // best-effort (captureError never throws), so it never delays or alters the
  // response. Only the request path is attached, never the body, query, or
  // headers, so no secret or client data reaches the wire. The path itself is
  // redacted first (Phase AB): the public diagnosis route carries a bearer share
  // token as a path segment, which must never reach the observability aggregator.
  void captureError(err, { subsystem: "http", route: redactRoute(req.path), level: "error" });
  res.status(500).json({ error: "Internal server error" });
});

export default app;
