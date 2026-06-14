import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { logger } from "./lib/logger";
import { requireAuth, requireOwner } from "./middleware/auth";
import { adminRouter } from "./routes/admin";
import { architectureRouter } from "./routes/architecture";
import { agentRouter } from "./routes/agent";
import { authRouter } from "./routes/auth";
import { clientRouter } from "./routes/client";
import { captureError } from "./lib/observability/sentryReporter";
import { healthRouter } from "./routes/health";
import { layersRouter } from "./routes/layers";
import { operationsRouter } from "./routes/operations";
import { retentionRouter } from "./routes/retention";
import { securityRouter } from "./routes/security";
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

app.use(express.json());

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

// Everything else under /api requires a valid, non-disabled session. requireAuth
// runs once here; the data routers follow. Per-tenant fencing is enforced inside
// the tenants router on the :id routes.
app.use("/api", requireAuth);
app.use("/api", layersRouter);
app.use("/api", architectureRouter);
app.use("/api", tenantsRouter);
app.use("/api", securityRouter);
app.use("/api", retentionRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error({ err: message }, "Request failed");
  // Phase P: capture the unhandled error to the aggregator. Fire-and-forget and
  // best-effort (captureError never throws), so it never delays or alters the
  // response. Only the request path is attached, never the body, query, or
  // headers, so no secret or client data reaches the wire.
  void captureError(err, { subsystem: "http", route: req.path, level: "error" });
  res.status(500).json({ error: "Internal server error" });
});

export default app;
