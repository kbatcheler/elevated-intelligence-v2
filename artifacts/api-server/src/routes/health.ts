import { sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "@workspace/db";
import { getSecretStore } from "../lib/secrets/secretStore";

export const healthRouter: Router = Router();

// Structured liveness and dependency health, unauthenticated so an uptime
// monitor can watch it. Every dependency status is the honest result of a real
// check: the database is reachable only after a SELECT 1 returns, the secret
// store only after a probe read does not throw. Model providers are never given
// a fabricated "ok": with no DSN-style ping that avoids spending tokens, a
// configured provider reads "unknown" by default (reachability not probed), and
// only a deep check (?deep=1) performs a network-level probe that reports
// reachable (any HTTP response) or unreachable (transport failure or timeout).

type DepStatus = "reachable" | "unreachable" | "not_configured" | "unknown";

interface Dependency {
  status: DepStatus;
  detail?: string;
}

async function checkDatabase(): Promise<Dependency> {
  try {
    await db.execute(sql`select 1`);
    return { status: "reachable" };
  } catch (err) {
    return { status: "unreachable", detail: err instanceof Error ? err.message : "query failed" };
  }
}

async function checkSecretStore(): Promise<Dependency> {
  try {
    // A harmless probe ref. A reachable store returns a value or null without
    // throwing; only an unreachable backing store throws.
    await getSecretStore().get("__health_probe__");
    return { status: "reachable" };
  } catch (err) {
    return { status: "unreachable", detail: err instanceof Error ? err.message : "probe failed" };
  }
}

// A model provider's reachability. The env var names mirror the cortex clients
// (anthropic.ts, gemini.ts) so the health view and the real call path agree on
// what "configured" means. No model tokens are ever spent: a deep probe opens a
// bare request to the base URL and treats ANY HTTP response as reachable; only a
// transport failure or timeout is unreachable.
async function checkProvider(
  baseUrlEnv: string,
  apiKeyEnv: string,
  deep: boolean,
  timeoutMs: number,
): Promise<Dependency> {
  const baseUrl = process.env[baseUrlEnv];
  const apiKey = process.env[apiKeyEnv];
  if (!baseUrl || !apiKey) return { status: "not_configured" };
  if (!deep) return { status: "unknown", detail: "configured; pass ?deep=1 to probe reachability" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl, { method: "GET", signal: controller.signal });
    return { status: "reachable", detail: "http " + res.status };
  } catch (err) {
    return { status: "unreachable", detail: err instanceof Error ? err.message : "probe failed" };
  } finally {
    clearTimeout(timer);
  }
}

healthRouter.get("/health", async (req, res) => {
  const deep =
    req.query.deep === "1" || req.query.deep === "true" || process.env.HEALTH_DEEP_CHECK === "1";
  const timeoutMs = 3000;

  const [database, secretStore, anthropic, gemini] = await Promise.all([
    checkDatabase(),
    checkSecretStore(),
    checkProvider(
      "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
      deep,
      timeoutMs,
    ),
    checkProvider(
      "AI_INTEGRATIONS_GEMINI_BASE_URL",
      "AI_INTEGRATIONS_GEMINI_API_KEY",
      deep,
      timeoutMs,
    ),
  ]);

  const dependencies = { database, secretStore, anthropic, gemini };

  // The database and secret store are existential: if either is unreachable the
  // service cannot do its job, so the overall status is unhealthy and we return
  // 503 for the uptime monitor. An unreachable provider is degraded, not down.
  // A provider that is unknown or not_configured does not count against health.
  let status: "healthy" | "degraded" | "unhealthy";
  if (database.status === "unreachable" || secretStore.status === "unreachable") {
    status = "unhealthy";
  } else if (anthropic.status === "unreachable" || gemini.status === "unreachable") {
    status = "degraded";
  } else {
    status = "healthy";
  }

  res
    .status(status === "unhealthy" ? 503 : 200)
    .json({ status, time: new Date().toISOString(), deep, dependencies });
});
