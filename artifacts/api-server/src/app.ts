import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { logger } from "./lib/logger";
import { requireAuth, requireOwner } from "./middleware/auth";
import { adminRouter } from "./routes/admin";
import { architectureRouter } from "./routes/architecture";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { layersRouter } from "./routes/layers";
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

// Everything else under /api requires a valid, non-disabled session. requireAuth
// runs once here; the data routers follow. Per-tenant fencing is enforced inside
// the tenants router on the :id routes.
app.use("/api", requireAuth);
app.use("/api", layersRouter);
app.use("/api", architectureRouter);
app.use("/api", tenantsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error({ err: message }, "Request failed");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
