import { spawn, type ChildProcess, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEATS } from "@workspace/cortex";
import {
  db,
  diagnosisShareTokensTable,
  forecastsTable,
  type InsertForecast,
  modelUsageTable,
  orgsTable,
  orgTenantsTable,
  provenanceLedgerTable,
  tenantLayersTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { mintShareToken } from "../lib/sellability/shareTokens";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// Phone-width overflow regression guard. The 375px audits for the operator and
// client surfaces (the <=480px block in artifacts/portal/src/index.css) were
// previously verified by hand with the live browser tool while logged in, so a
// future table or grid change could silently reintroduce page-level horizontal
// overflow on a phone with no test failing. This drives the REAL built portal,
// served by the api-server single-container model, in a headless browser at a
// 375px viewport, logs in through the real session cookie, and asserts
// document.documentElement.scrollWidth <= window.innerWidth on every key surface.
//
// Zero new dependencies: it builds the portal with the workspace's own vite and
// drives the platform Playwright chromium binary directly over the Chrome
// DevTools Protocol using Node built-ins (child_process, the global WebSocket,
// JSON), the same browser the manual audits used, never an SDK.
const RUN = `overflowtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL_PREFIX = `${RUN}-`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const LAYER_KEY = "business-performance";
const VIEWPORT_W = 375;
const VIEWPORT_H = 720;

const CHROMIUM = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "";

const testStore: SecretStore = {
  async get(ref) {
    return ref === "SESSION_SECRET" ? SECRET : null;
  },
  async set() {},
  async delete() {},
};

function email(local: string): string {
  return `${EMAIL_PREFIX}${local}@example.com`;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A real, schema-valid layer projection so the Brief and the public diagnosis
// render their populated content (cards, metric tiles) rather than an empty
// state - the populated layout is what can overflow on a phone.
const layerContent = {
  narrative:
    "Renewal recovery is leaking because dunning stops after a single retry, so recoverable revenue is lost each cycle.",
  headline_finding: "Dunning stops too early",
  headline_impact: "Lost renewals",
  headline_lever: "Add staged retries",
  causes: [
    {
      title: "Single retry only",
      impact: "Lost recoveries",
      detail: "The system makes one attempt then gives up.",
      confidence: 60,
      basis: "modelled",
    },
  ],
  actions: [
    {
      title: "Stage the retries",
      detail: "Retry on day 1, 3 and 7 with escalating messaging.",
      impact: "Recovers about 18000 dollars per quarter",
      confidence: 72,
      basis: "modelled",
    },
  ],
  hypotheses: [],
  proof: { items: [] },
  gaps: [],
  metrics: [
    { label: "Recovery rate", value: "41%", tone: "warn", confidence: 55, basis: "modelled" },
  ],
  confidence: 64,
  confidence_gap: 20,
};

let server: Server;
let base: string;
let distDir: string;
let browser: Browser;
let ownerSession = "";
let clientSession = "";
let shareToken = "";

const ids = {
  providerOrg: "",
  clientOrg: "",
  tenant: "",
  owner: "",
  clientAdmin: "",
};

// ---------------------------------------------------------------------------
// A minimal Chrome DevTools Protocol client over the global WebSocket. It spawns
// the platform chromium, reads the debugger URL from stderr, and routes flat
// (sessionId-tagged) command responses back to their awaiting caller. Only the
// request/response half is needed; surfaces are measured by polling, not events.
// ---------------------------------------------------------------------------
class Browser {
  private nextId = 1;
  private readonly pending = new Map<number, (msg: CdpMessage) => void>();

  private constructor(
    private readonly proc: ChildProcess,
    private readonly ws: WebSocket,
    private readonly userDir: string,
  ) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (typeof msg.id === "number") {
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  static async launch(): Promise<Browser> {
    const userDir = mkdtempSync(path.join(tmpdir(), "portal-overflow-chrome-"));
    const proc = spawn(
      CHROMIUM,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDir}`,
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let buf = "";
    const wsUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for chromium devtools url: ${buf}`)),
        20_000,
      );
      proc.stderr?.on("data", (d) => {
        buf += String(d);
        const m = /ws:\/\/[^\s]+/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`chromium exited early (${code}): ${buf}`));
      });
    });

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("chromium websocket error")), {
        once: true,
      });
    });

    return new Browser(proc, ws, userDir);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CdpResult> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, (msg) => {
        if (msg.error) {
          reject(new Error(`cdp ${method} failed: ${msg.error.message}`));
        } else {
          resolve(msg.result ?? {});
        }
      });
      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  async close(): Promise<void> {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    this.proc.kill("SIGKILL");
    rmSync(this.userDir, { recursive: true, force: true });
  }
}

interface CdpMessage {
  id?: number;
  result?: CdpResult;
  error?: { message: string };
}
type CdpResult = Record<string, unknown> & {
  sessionId?: string;
  targetId?: string;
  browserContextId?: string;
  result?: { value?: string };
};

// Open an isolated incognito context (its own cookie jar and localStorage),
// attach a page at the 375px viewport, optionally plant the session cookie and
// the selected-tenant localStorage key the portal reads after login.
async function openPage(opts: { cookie?: string; tenantId?: string }): Promise<string> {
  const ctx = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const browserContextId = ctx.browserContextId as string;
  const tgt = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const att = await browser.send("Target.attachToTarget", {
    targetId: tgt.targetId,
    flatten: true,
  });
  const session = att.sessionId as string;

  await browser.send("Page.enable", {}, session);
  await browser.send("Runtime.enable", {}, session);
  await browser.send("Network.enable", {}, session);
  await browser.send(
    "Emulation.setDeviceMetricsOverride",
    { width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: 1, mobile: false },
    session,
  );
  if (opts.cookie) {
    await browser.send(
      "Network.setCookie",
      { name: "ei_session", value: opts.cookie, url: base, path: "/", httpOnly: true },
      session,
    );
  }
  if (opts.tenantId) {
    await browser.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: `try{localStorage.setItem('ei.tenantId',${JSON.stringify(opts.tenantId)});}catch(e){}` },
      session,
    );
  }
  return session;
}

interface SurfaceMeasure {
  sw: number;
  iw: number;
  ready: boolean;
  hasPassword: boolean;
}

// Navigate, then poll until the SPA has mounted and the layout width has settled
// (data arrives asynchronously and reflows the page), then read the overflow
// figures. Caps at a generous deadline so a genuinely stuck page still returns.
async function gotoAndMeasure(session: string, route: string): Promise<SurfaceMeasure> {
  await browser.send("Page.navigate", { url: base + route }, session);
  const deadline = Date.now() + 12_000;
  let snapshot: SurfaceMeasure = { sw: -1, iw: -1, ready: false, hasPassword: false };
  let prevSw = -2;
  let stable = 0;
  while (Date.now() < deadline) {
    await delay(250);
    const res = await browser.send(
      "Runtime.evaluate",
      {
        expression:
          "JSON.stringify({" +
          "sw:document.documentElement.scrollWidth," +
          "iw:window.innerWidth," +
          "ready:((document.getElementById('root')||{}).childElementCount||0)>0||document.body.childElementCount>1," +
          "hasPassword:!!document.querySelector('input[type=password]')" +
          "})",
        returnByValue: true,
      },
      session,
    );
    const raw = res.result?.value;
    if (typeof raw !== "string") continue;
    const cur = JSON.parse(raw) as SurfaceMeasure;
    snapshot = cur;
    if (cur.ready && cur.sw === prevSw) {
      stable += 1;
      if (stable >= 2) break;
    } else {
      stable = 0;
    }
    prevSw = cur.sw;
  }
  return snapshot;
}

async function seedUser(
  local: string,
  role: "provider-owner" | "client-admin",
  orgId: string,
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status: "active", orgId })
    .returning({ id: usersTable.id });
  return inserted[0]!.id;
}

async function login(local: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email(local), password: PASSWORD }),
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const m = /^ei_session=([^;]*)/.exec(c);
    if (m && m[1]) return m[1];
  }
  throw new Error(`login failed for ${local}: status ${res.status}`);
}

beforeAll(async () => {
  if (!CHROMIUM || !existsSync(CHROMIUM)) {
    throw new Error(
      "REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is not set or missing; the phone-width " +
        "overflow guard needs the platform chromium to measure real layout.",
    );
  }
  setSecretStore(testStore);

  // Build the portal from the CURRENT source so the guard tests today's CSS, not
  // a stale artifact. Built into a temp dir to avoid clobbering the dev dist, in
  // production mode so no dev-only plugins enter the bundle.
  const portalDir = path.resolve(process.cwd(), "..", "portal");
  distDir = mkdtempSync(path.join(tmpdir(), "portal-overflow-dist-"));
  execFileSync(
    "pnpm",
    ["exec", "vite", "build", "--config", "vite.config.ts", "--outDir", distDir, "--emptyOutDir", "--logLevel", "warn"],
    { cwd: portalDir, env: { ...process.env, NODE_ENV: "production" }, stdio: "inherit" },
  );
  if (!existsSync(path.join(distDir, "index.html"))) {
    throw new Error("portal build did not produce an index.html");
  }
  process.env.PORTAL_DIST_DIR = distDir;

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Provider`, type: "provider" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg!.id;
  const [clientOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Client`, type: "client" })
    .returning({ id: orgsTable.id });
  ids.clientOrg = clientOrg!.id;

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.clientAdmin = await seedUser("admin", "client-admin", ids.clientOrg);

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant`, url: `https://t.${RUN}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant!.id;
  await db.insert(orgTenantsTable).values({ orgId: ids.clientOrg, tenantId: ids.tenant });

  // Populate the surfaces that render tables and multi-column grids so the
  // overflow-prone layouts actually appear: the Brief/public diagnosis (layer
  // content), Spend (model usage), and Calibration/Outcome loop (forecasts).
  await db.insert(tenantLayersTable).values({
    tenantId: ids.tenant,
    layerKey: LAYER_KEY,
    content: layerContent,
    generatorModel: "test-fixture",
  });

  const reasonerModel = SEATS.reasoner.model;
  await db.insert(modelUsageTable).values([
    {
      tenantId: ids.tenant,
      runId: randomUUID(),
      stage: "perceive",
      layerKey: LAYER_KEY,
      seat: "reasoner",
      model: reasonerModel,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: "0.500000",
    },
    {
      tenantId: ids.tenant,
      runId: randomUUID(),
      stage: "score",
      layerKey: LAYER_KEY,
      seat: "reasoner",
      model: reasonerModel,
      inputTokens: 2000,
      outputTokens: 800,
      costUsd: "1.250000",
    },
  ]);

  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const forecasts: InsertForecast[] = [
    {
      tenantId: ids.tenant,
      layerKey: LAYER_KEY,
      runId: randomUUID(),
      sourceStage: "score",
      subjectSeat: "Evaluator",
      sourcePath: "metrics[0]",
      statement: "Churn rises above 5 percent within the quarter",
      probability: "0.3500",
      kind: "risk_occurrence",
      madeAt: now,
      resolveBy: new Date(now.getTime() + 90 * day),
    },
    {
      tenantId: ids.tenant,
      layerKey: LAYER_KEY,
      runId: randomUUID(),
      sourceStage: "score",
      subjectSeat: "Evaluator",
      sourcePath: "metrics[0]",
      statement: "Recovery rate improves after staged retries ship",
      probability: "0.6500",
      kind: "action_outcome",
      madeAt: new Date(now.getTime() - 120 * day),
      resolveBy: new Date(now.getTime() - 30 * day),
      resolvedAt: new Date(now.getTime() - 30 * day),
      outcome: 1,
      brierScore: "0.122500",
      resolutionBasis: "owner",
    },
  ];
  await db.insert(forecastsTable).values(forecasts);

  const minted = await mintShareToken({ tenantId: ids.tenant, createdBy: ids.owner });
  shareToken = minted.token;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ownerSession = await login("owner");
  clientSession = await login("admin");

  browser = await Browser.launch();
}, 300_000);

afterAll(async () => {
  try {
    await db.delete(modelUsageTable).where(eq(modelUsageTable.tenantId, ids.tenant));
    await db.delete(forecastsTable).where(eq(forecastsTable.tenantId, ids.tenant));
    await db.delete(tenantLayersTable).where(eq(tenantLayersTable.tenantId, ids.tenant));
    await db
      .delete(diagnosisShareTokensTable)
      .where(eq(diagnosisShareTokensTable.tenantId, ids.tenant));
    await db.delete(provenanceLedgerTable).where(eq(provenanceLedgerTable.tenantId, ids.tenant));
    await db.delete(orgTenantsTable).where(eq(orgTenantsTable.tenantId, ids.tenant));
    await db.delete(usersTable).where(inArray(usersTable.id, [ids.owner, ids.clientAdmin]));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
  } finally {
    setSecretStore(null);
    delete process.env.PORTAL_DIST_DIR;
    if (browser) await browser.close();
    if (distDir) rmSync(distDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}, 60_000);

function assertNoOverflow(route: string, m: SurfaceMeasure, expectAuthed: boolean): void {
  expect(m.ready, `route ${route} never mounted the portal`).toBe(true);
  if (expectAuthed) {
    expect(
      m.hasPassword,
      `route ${route} fell back to the login gate; the session cookie was not applied`,
    ).toBe(false);
  }
  expect(
    m.sw,
    `route ${route} overflows at ${VIEWPORT_W}px: scrollWidth ${m.sw} > innerWidth ${m.iw}`,
  ).toBeLessThanOrEqual(m.iw);
}

describe("portal phone-width overflow guard (375px)", () => {
  it("provider/owner surfaces do not overflow horizontally", async () => {
    const session = await openPage({ cookie: ownerSession, tenantId: ids.tenant });
    const routes = [
      "/",
      "/outcome-loop",
      "/war-room",
      "/admin",
      "/spend",
      "/calibration",
      "/security",
      "/connections",
      "/break-glass",
    ];
    for (const route of routes) {
      const m = await gotoAndMeasure(session, route);
      assertNoOverflow(route, m, true);
    }
  }, 180_000);

  it("the client-admin onboarding surface does not overflow horizontally", async () => {
    const session = await openPage({ cookie: clientSession, tenantId: ids.tenant });
    const m = await gotoAndMeasure(session, "/onboarding");
    assertNoOverflow("/onboarding", m, true);
  }, 60_000);

  it("the public shared diagnosis does not overflow horizontally", async () => {
    const session = await openPage({});
    const m = await gotoAndMeasure(session, `/d/${shareToken}`);
    assertNoOverflow(`/d/${shareToken}`, m, false);
  }, 60_000);
});
