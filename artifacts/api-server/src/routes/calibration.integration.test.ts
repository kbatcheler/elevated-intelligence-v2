import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scoreOutputSchema } from "@workspace/cortex";
import {
  committedActionsTable,
  db,
  forecastsTable,
  type InsertForecast,
  orgsTable,
  outcomeMeasurementsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import {
  outcomeFromMeasurementStatus,
  resolveForecastsForMeasurement,
} from "../lib/calibration/forecastResolution";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the Phase AJ Brier-scored calibration ledger over a
// real Postgres: a forecast persisted from the real Evaluator output shape, an
// owner adjudication computing the Brier score server-side, a measurement
// auto-resolving a linked forecast, a deliberately wrong forecast worsening the
// aggregate, misses present in the ledger, and the owner/tenant scope split.
// Rows are namespaced and removed afterwards so the suite is self-cleaning.
const RUN = "calibtest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const EMAIL_PREFIX = RUN + "-";
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";

const testStore: SecretStore = {
  async get(ref) {
    return ref === "SESSION_SECRET" ? SECRET : null;
  },
  async set() {},
  async delete() {},
};

function email(local: string): string {
  return EMAIL_PREFIX + local + "@example.com";
}

let server: Server;
let base: string;
const ids = { providerOrg: "", owner: "", member: "", tenantA: "", tenantB: "" };

async function seedUser(local: string, role: "provider-owner" | "provider-member"): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({
      email: email(local),
      displayName: local,
      passwordHash,
      role,
      status: "active",
      orgId: ids.providerOrg,
    })
    .returning({ id: usersTable.id });
  return inserted[0]!.id;
}

interface ApiResult {
  status: number;
  json: unknown;
  session: string | null;
}

function readSession(res: Response, fallback: string | null): string | null {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const m = /^ei_session=([^;]*)/.exec(c);
    if (m) return m[1] === "" ? null : m[1];
  }
  return fallback;
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; session?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.session) headers["cookie"] = "ei_session=" + opts.session;
  const res = await fetch(base + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, session: readSession(res, opts.session ?? null) };
}

async function loginSession(local: string): Promise<string> {
  const r = await api("/api/auth/login", {
    method: "POST",
    body: { email: email(local), password: PASSWORD },
  });
  expect(r.status).toBe(200);
  return r.session as string;
}

// Insert a forecast the way the orchestrator does: from a SCORE output validated
// through the real cortex schema, mapped field-for-field, with horizon_days
// turned into a concrete resolveBy. This proves the ledger is fed by the real
// Evaluator output shape, never synthesised from a verdict string.
async function persistFromScoreOutput(tenantId: string, layerKey: string, raw: unknown): Promise<string[]> {
  const score = scoreOutputSchema.parse(raw);
  const madeAt = new Date();
  const rows: InsertForecast[] = score.forecasts.map((f) => ({
    tenantId,
    layerKey,
    runId: randomUUID(),
    sourceStage: "score",
    subjectSeat: f.subject_seat,
    sourcePath: f.source_path ?? null,
    statement: f.statement,
    probability: String(f.probability),
    kind: f.kind,
    madeAt,
    resolveBy: new Date(madeAt.getTime() + f.horizon_days * 24 * 60 * 60 * 1000),
  }));
  if (rows.length === 0) return [];
  const inserted = await db.insert(forecastsTable).values(rows).returning({ id: forecastsTable.id });
  return inserted.map((r) => r.id);
}

beforeAll(async () => {
  setSecretStore(testStore);

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: RUN + " Provider", type: "provider" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg!.id;

  ids.owner = await seedUser("owner", "provider-owner");
  ids.member = await seedUser("member", "provider-member");

  const [tenantA] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " A", url: "https://a." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantA = tenantA!.id;
  const [tenantB] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " B", url: "https://b." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantB = tenantB!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    // forecasts cascade from the tenant; delete tenants (and their cascades) then
    // the users and org. committed_actions and outcome_measurements cascade too.
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenantA, ids.tenantB]));
    await db.delete(usersTable).where(inArray(usersTable.id, [ids.owner, ids.member]));
    await db.delete(orgsTable).where(eq(orgsTable.id, ids.providerOrg));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("outcomeFromMeasurementStatus", () => {
  it("resolves only terminal statuses, leaving in-flight ones open", () => {
    expect(outcomeFromMeasurementStatus("realized")).toBe(1);
    expect(outcomeFromMeasurementStatus("missed")).toBe(0);
    expect(outcomeFromMeasurementStatus("pending")).toBeNull();
    expect(outcomeFromMeasurementStatus("on_track")).toBeNull();
  });
});

describe("forecast persistence from the real Evaluator output", () => {
  it("persists forecasts mapped from a schema-valid SCORE output", async () => {
    const ids2 = await persistFromScoreOutput(ids.tenantB, "persist-proof", {
      confidence: 70,
      confidence_gap: 10,
      gaps: [],
      claims: [],
      forecasts: [
        {
          kind: "risk_occurrence",
          subject_seat: "Evaluator",
          source_path: "metrics[0]",
          statement: "Churn rises above 5 percent within the quarter",
          probability: 0.35,
          horizon_days: 90,
        },
      ],
    });
    expect(ids2).toHaveLength(1);
    const row = (
      await db.select().from(forecastsTable).where(eq(forecastsTable.id, ids2[0])).limit(1)
    )[0]!;
    expect(Number(row.probability)).toBe(0.35);
    expect(row.kind).toBe("risk_occurrence");
    expect(row.sourcePath).toBe("metrics[0]");
    expect(row.outcome).toBeNull();
    expect(row.brierScore).toBeNull();
    expect(row.resolvedAt).toBeNull();
    // horizon_days became a concrete resolveBy in the future.
    expect(row.resolveBy.getTime()).toBeGreaterThan(row.madeAt.getTime());
  });
});

describe("owner adjudication over HTTP", () => {
  it("computes the Brier score server-side for a hit and records owner basis", async () => {
    const [id] = await persistFromScoreOutput(ids.tenantA, "owner-hit", {
      confidence: 80,
      confidence_gap: 10,
      gaps: [],
      claims: [],
      forecasts: [
        {
          kind: "action_outcome",
          source_path: "actions[0]",
          statement: "The recovery action lands within the quarter",
          probability: 0.9,
          horizon_days: 60,
        },
      ],
    });
    const owner = await loginSession("owner");
    const r = await api("/api/calibration/forecasts/" + id + "/resolve", {
      method: "POST",
      body: { outcome: 1, note: "verified in the QBR" },
      session: owner,
    });
    expect(r.status).toBe(200);
    const row = (
      await db.select().from(forecastsTable).where(eq(forecastsTable.id, id)).limit(1)
    )[0]!;
    expect(row.outcome).toBe(1);
    expect(Number(row.brierScore)).toBe(0.01); // (0.9 - 1)^2
    expect(row.resolutionBasis).toBe("owner");
    expect(row.resolvedBy).toBe(ids.owner);
    expect(row.resolvedAt).not.toBeNull();
  });

  it("rejects a member, and 409s a second adjudication of the same forecast", async () => {
    const [id] = await persistFromScoreOutput(ids.tenantA, "owner-twice", {
      confidence: 50,
      confidence_gap: 10,
      gaps: [],
      claims: [],
      forecasts: [
        {
          kind: "finding_survival",
          statement: "The finding survives external challenge",
          probability: 0.6,
          horizon_days: 30,
        },
      ],
    });
    const member = await loginSession("member");
    const denied = await api("/api/calibration/forecasts/" + id + "/resolve", {
      method: "POST",
      body: { outcome: 1 },
      session: member,
    });
    expect(denied.status).toBe(403);

    const owner = await loginSession("owner");
    const first = await api("/api/calibration/forecasts/" + id + "/resolve", {
      method: "POST",
      body: { outcome: 0 },
      session: owner,
    });
    expect(first.status).toBe(200);
    const second = await api("/api/calibration/forecasts/" + id + "/resolve", {
      method: "POST",
      body: { outcome: 1 },
      session: owner,
    });
    expect(second.status).toBe(409);
  });
});

describe("measurement-driven auto-resolution", () => {
  async function seedActionWithForecast(probability: number): Promise<{ actionId: string; forecastId: string }> {
    const [action] = await db
      .insert(committedActionsTable)
      .values({
        tenantId: ids.tenantB,
        layerKey: "auto-resolve",
        title: "Recover lost margin",
        basis: "modelled",
        confidence: 70,
        committedBy: ids.owner,
      })
      .returning({ id: committedActionsTable.id });
    const [forecast] = await db
      .insert(forecastsTable)
      .values({
        tenantId: ids.tenantB,
        layerKey: "auto-resolve",
        sourceStage: "score",
        subjectSeat: "Evaluator",
        statement: "The committed action realizes its predicted recovery",
        probability: String(probability),
        kind: "action_outcome",
        committedActionId: action!.id,
        resolveBy: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: forecastsTable.id });
    return { actionId: action!.id, forecastId: forecast!.id };
  }

  it("resolves a linked forecast TRUE from a realized measurement, basis measured", async () => {
    const { actionId, forecastId } = await seedActionWithForecast(0.7);
    const [m] = await db
      .insert(outcomeMeasurementsTable)
      .values({ actionId, basis: "measured", status: "realized", recordedBy: ids.owner })
      .returning({ id: outcomeMeasurementsTable.id });
    const resolved = await resolveForecastsForMeasurement({
      actionId,
      measurementId: m!.id,
      status: "realized",
      basis: "measured",
    });
    expect(resolved).toBe(1);
    const row = (
      await db.select().from(forecastsTable).where(eq(forecastsTable.id, forecastId)).limit(1)
    )[0]!;
    expect(row.outcome).toBe(1);
    expect(Number(row.brierScore)).toBe(0.09); // (0.7 - 1)^2
    expect(row.resolutionBasis).toBe("measured");
    expect(row.outcomeMeasurementId).toBe(m!.id);
  });

  it("leaves a forecast open for a non-terminal measurement", async () => {
    const { actionId, forecastId } = await seedActionWithForecast(0.7);
    const [m] = await db
      .insert(outcomeMeasurementsTable)
      .values({ actionId, basis: "modelled", status: "pending", recordedBy: ids.owner })
      .returning({ id: outcomeMeasurementsTable.id });
    const resolved = await resolveForecastsForMeasurement({
      actionId,
      measurementId: m!.id,
      status: "pending",
      basis: "modelled",
    });
    expect(resolved).toBe(0);
    const row = (
      await db.select().from(forecastsTable).where(eq(forecastsTable.id, forecastId)).limit(1)
    )[0]!;
    expect(row.resolvedAt).toBeNull();
    expect(row.outcome).toBeNull();
  });
});

describe("tenant-scoped summary, misses, and the worsening aggregate", () => {
  it("a deliberately wrong forecast worsens the aggregate and shows as a miss", async () => {
    const owner = await loginSession("owner");

    // A good, confident hit resolved by the owner: (0.9 - 1)^2 = 0.01.
    const [good] = await persistFromScoreOutput(ids.tenantA, "agg-good", {
      confidence: 90,
      confidence_gap: 10,
      gaps: [],
      claims: [],
      forecasts: [
        {
          kind: "action_outcome",
          statement: "The flagged recovery materialises",
          probability: 0.9,
          horizon_days: 30,
        },
      ],
    });
    await api("/api/calibration/forecasts/" + good + "/resolve", {
      method: "POST",
      body: { outcome: 1 },
      session: owner,
    });

    const before = await api("/api/calibration?tenantId=" + ids.tenantA, { session: owner });
    expect(before.status).toBe(200);
    const beforeBody = before.json as { headline: { meanBrier: number } };
    const beforeBrier = beforeBody.headline.meanBrier;

    // A deliberately wrong, confident forecast resolved FALSE: (0.95 - 0)^2 = 0.9025.
    const [wrong] = await persistFromScoreOutput(ids.tenantA, "agg-wrong", {
      confidence: 95,
      confidence_gap: 10,
      gaps: [],
      claims: [],
      forecasts: [
        {
          kind: "risk_occurrence",
          statement: "The named risk does NOT occur",
          probability: 0.95,
          horizon_days: 30,
        },
      ],
    });
    await api("/api/calibration/forecasts/" + wrong + "/resolve", {
      method: "POST",
      body: { outcome: 0 },
      session: owner,
    });

    const after = await api("/api/calibration?tenantId=" + ids.tenantA, { session: owner });
    expect(after.status).toBe(200);
    const body = after.json as {
      scope: { kind: string; tenantId: string };
      baseline: number;
      headline: { meanBrier: number; n: number };
      ledger: { id: string; outcome: number; brierScore: number }[];
    };
    expect(body.scope.kind).toBe("tenant");
    expect(body.scope.tenantId).toBe(ids.tenantA);
    expect(body.baseline).toBe(0.25);
    // The wrong forecast pushed the mean up toward the baseline and past it.
    expect(body.headline.meanBrier).toBeGreaterThan(beforeBrier);
    // The ledger is a track record, not a highlight reel: the miss is present.
    const missRow = body.ledger.find((r) => r.id === wrong);
    expect(missRow).toBeDefined();
    expect(missRow!.outcome).toBe(0);
    expect(missRow!.brierScore).toBe(0.9025);
  });
});

describe("scope authorization", () => {
  it("owner sees the system-wide summary; a member is forbidden from it", async () => {
    const owner = await loginSession("owner");
    const member = await loginSession("member");
    const ownerSystem = await api("/api/calibration", { session: owner });
    expect(ownerSystem.status).toBe(200);
    expect((ownerSystem.json as { scope: { kind: string } }).scope.kind).toBe("system");
    const memberSystem = await api("/api/calibration", { session: member });
    expect(memberSystem.status).toBe(403);
  });

  it("requires a session", async () => {
    const r = await api("/api/calibration");
    expect(r.status).toBe(401);
  });
});
