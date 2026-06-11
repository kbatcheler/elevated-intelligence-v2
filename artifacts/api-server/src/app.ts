import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { logger } from "./lib/logger";
import { healthRouter } from "./routes/health";
import { layersRouter } from "./routes/layers";
import { tenantsRouter } from "./routes/tenants";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/", healthRouter);
app.use("/api", layersRouter);
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
