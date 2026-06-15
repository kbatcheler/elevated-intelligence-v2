import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../app";

// The single-container production model: when PORTAL_DIST_DIR is set the API
// serves the built portal SPA at "/" and any client-side route, serves the real
// hashed assets, but never lets the HTML shell shadow an API path. This is what
// makes the production Dockerfile a single image that runs the full system. The
// default (unset) is exercised by every other integration test, which all see a
// pure JSON API, so here we only prove the configured behaviour.

let server: Server;
let base: string;
let distDir: string;
const SHELL = "<!doctype html><title>portal shell</title><div id=root></div>";
const ASSET = "console.log('built asset');";

beforeAll(async () => {
  distDir = mkdtempSync(path.join(tmpdir(), "portal-dist-"));
  mkdirSync(path.join(distDir, "assets"), { recursive: true });
  writeFileSync(path.join(distDir, "index.html"), SHELL, "utf8");
  writeFileSync(path.join(distDir, "assets", "app-abc123.js"), ASSET, "utf8");
  process.env.PORTAL_DIST_DIR = distDir;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  delete process.env.PORTAL_DIST_DIR;
  rmSync(distDir, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("portal static serving (single-container production model)", () => {
  it("serves the SPA shell at the root", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
  });

  it("serves the SPA shell for a deep client-side route", async () => {
    const res = await fetch(base + "/tenants/some-deep-link");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
  });

  it("serves a real built asset, not the shell", async () => {
    const res = await fetch(base + "/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ASSET);
  });

  it("never lets the HTML shell shadow an API-namespace path", async () => {
    // An unknown /v1 path has no session gate and is skipped by the SPA
    // fallback, so it reaches the honest JSON 404, never the HTML shell.
    const unknown = await fetch(base + "/v1/does-not-exist");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toMatch(/application\/json/);
    const notFound = (await unknown.json()) as { error: string };
    expect(notFound.error).toBe("Not found");

    // An unknown /api path is caught by the shared session gate and returns a
    // JSON 401, again never the HTML shell.
    const guarded = await fetch(base + "/api/does-not-exist");
    expect(guarded.status).toBe(401);
    expect(guarded.headers.get("content-type")).toMatch(/application\/json/);
    const unauthenticated = (await guarded.json()) as { error: string };
    expect(unauthenticated.error).toBe("unauthenticated");
  });

  it("still serves the unauthenticated health route, not the shell", async () => {
    const res = await fetch(base + "/health");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { status: string };
    expect(["healthy", "degraded", "unhealthy"]).toContain(body.status);
  });
});
