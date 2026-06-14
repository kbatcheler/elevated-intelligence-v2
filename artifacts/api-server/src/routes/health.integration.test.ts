import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../app";

// The structured health route over HTTP. The database and secret store are real
// and reachable in the test environment, so the route reports them reachable and
// returns 200. Model providers are reported honestly: without a deep probe they
// are NEVER fabricated "reachable" (configured -> unknown, absent ->
// not_configured), which is the whole point of the rewrite.

let server: Server;
let base: string;

interface HealthBody {
  status: "healthy" | "degraded" | "unhealthy";
  time: string;
  deep: boolean;
  dependencies: {
    database: { status: string };
    secretStore: { status: string };
    anthropic: { status: string };
    gemini: { status: string };
  };
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("GET /health", () => {
  it("reports a real per-dependency status with the database and secret store reachable", async () => {
    const res = await fetch(base + "/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(["healthy", "degraded"]).toContain(body.status);
    expect(typeof body.time).toBe("string");
    expect(body.dependencies.database.status).toBe("reachable");
    expect(body.dependencies.secretStore.status).toBe("reachable");
  });

  it("never fabricates a provider 'reachable' without a deep probe", async () => {
    const res = await fetch(base + "/health");
    const body = (await res.json()) as HealthBody;
    expect(body.deep).toBe(false);
    for (const dep of [body.dependencies.anthropic, body.dependencies.gemini]) {
      expect(["unknown", "not_configured"]).toContain(dep.status);
      expect(dep.status).not.toBe("reachable");
    }
  });
});
