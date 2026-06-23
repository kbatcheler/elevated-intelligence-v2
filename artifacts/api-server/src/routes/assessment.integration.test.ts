import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentSubmissionsTable, db } from "@workspace/db";
import app from "../app";

// End-to-end exercise of the Intelligence Gap Assessment public funnel (Phase
// AT) against a real Postgres, over HTTP through a throwaway listener. The funnel
// is unauthenticated top-of-funnel, so no session is ever set; the harness is
// self-cleaning, deleting every submission it creates (its share tokens cascade).
//
// The shape under test is the acceptance contract: the question bank withholds
// option scores so the prospect answers honestly; a submit returns the FREE
// on-screen result with no contact; a contact mints a forwardable token whose
// report resolves; and the optional outside_in diagnosis is BOUNDED and DEGRADES
// gracefully - a url whose public footprint cannot be read resolves to
// "unavailable" with no profile, no telemetry and no model spend, leaving the
// self-assessment intact.
const RUN = `assess-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface ApiResult {
  status: number;
  json: unknown;
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
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
  return { status: res.status, json };
}

// Strong, honest answers across every dimension. A genuinely sharp operation
// scores well: the instrument is not rigged to fail everyone.
const STRONG_ANSWERS: Record<string, "blind" | "partial" | "ahead"> = {
  visibility_attribution: "ahead",
  visibility_customer_view: "ahead",
  visibility_margin: "ahead",
  speed_close: "ahead",
  speed_alerting: "ahead",
  foresight_churn: "ahead",
  foresight_forecast: "ahead",
  foresight_cash: "ahead",
  confidence_reporting: "ahead",
  confidence_decisions: "ahead",
};

// Weak answers across every dimension, to prove the gap mapping surfaces layers.
const WEAK_ANSWERS: Record<string, "blind" | "partial" | "ahead"> = {
  visibility_attribution: "blind",
  visibility_customer_view: "blind",
  visibility_margin: "blind",
  speed_close: "blind",
  speed_alerting: "blind",
  foresight_churn: "blind",
  foresight_forecast: "blind",
  foresight_cash: "blind",
  confidence_reporting: "blind",
  confidence_decisions: "blind",
};

const QUALIFICATION = {
  sector: "technology",
  revenueBand: "20m_100m",
  systems: ["crm", "erp"],
};

let server: Server;
let base: string;
const createdIds: string[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  try {
    if (createdIds.length > 0) {
      await db
        .delete(assessmentSubmissionsTable)
        .where(inArray(assessmentSubmissionsTable.id, createdIds));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("Intelligence Gap Assessment funnel", () => {
  it("serves the question bank with option scores withheld", async () => {
    const r = await api("/api/public/assessment/questions");
    expect(r.status).toBe(200);
    const bank = (r.json as { questions: any }).questions;
    expect(bank.scored).toHaveLength(10);
    expect(bank.qualification).toHaveLength(3);
    expect(bank.dimensions).toHaveLength(4);
    // No option may leak its score: the prospect answers behaviour, not weighting.
    for (const q of bank.scored) {
      for (const o of q.options) {
        expect(o).toHaveProperty("key");
        expect(o).toHaveProperty("label");
        expect(o).not.toHaveProperty("score");
      }
    }
  });

  it("scores a submission and returns the free on-screen result with no contact", async () => {
    const strong = await api("/api/public/assessment/submit", {
      method: "POST",
      body: { answers: STRONG_ANSWERS, qualification: QUALIFICATION },
    });
    expect(strong.status).toBe(200);
    const sBody = strong.json as { submissionId: string; result: any };
    expect(sBody.submissionId).toBeTruthy();
    createdIds.push(sBody.submissionId);
    // A strong operation passes: the instrument is honest, not manipulative.
    expect(sBody.result.overall.score).toBeGreaterThanOrEqual(80);
    expect(sBody.result.oneLine).toContain("records what happened");

    const weak = await api("/api/public/assessment/submit", {
      method: "POST",
      body: { answers: WEAK_ANSWERS, qualification: QUALIFICATION },
    });
    expect(weak.status).toBe(200);
    const wBody = weak.json as { submissionId: string; result: any };
    createdIds.push(wBody.submissionId);
    // A blind operation scores low and the gap maps onto canonical layers.
    expect(wBody.result.overall.score).toBeLessThanOrEqual(20);
    expect(wBody.result.gapToLayers.length).toBeGreaterThan(0);
    for (const g of wBody.result.gapToLayers) {
      expect(g.layerKey).toBeTruthy();
      expect(g.layerName).toBeTruthy();
      expect(g.closes).toBeTruthy();
    }
    // The on-screen result is the full payload: no contact was ever required.
    expect(wBody.result.cost.lines.length).toBeGreaterThan(0);
  });

  it("rejects a malformed submission", async () => {
    const r = await api("/api/public/assessment/submit", {
      method: "POST",
      body: { answers: { visibility_attribution: "ahead" }, qualification: QUALIFICATION },
    });
    expect(r.status).toBe(400);
  });

  it("captures a contact, mints a forwardable report, and the token resolves", async () => {
    const sub = await api("/api/public/assessment/submit", {
      method: "POST",
      body: { answers: STRONG_ANSWERS, qualification: QUALIFICATION },
    });
    const submissionId = (sub.json as { submissionId: string }).submissionId;
    createdIds.push(submissionId);

    const contact = await api(`/api/public/assessment/submissions/${submissionId}/contact`, {
      method: "POST",
      body: { name: "Pat", email: `${RUN}@example.com`, company: "Example Ltd" },
    });
    expect(contact.status).toBe(200);
    const cBody = contact.json as {
      reportPath: string;
      reportUrl: string;
      expiresAt: string;
      emailStatus: string;
      diagnosisRequested: boolean;
    };
    expect(cBody.reportPath).toMatch(/^\/a\//);
    // No company url was supplied, so no diagnosis is requested.
    expect(cBody.diagnosisRequested).toBe(false);
    // The email seam is available-not-connected by default: honest, never faked.
    expect(["not_connected", "sent", "failed"]).toContain(cBody.emailStatus);

    const token = cBody.reportPath.split("/").pop() as string;
    const report = await api(`/api/public/assessment/report/${token}`);
    expect(report.status).toBe(200);
    const rep = (report.json as { report: any }).report;
    expect(rep.contactCaptured).toBe(true);
    expect(rep.overall.score).toBeGreaterThanOrEqual(80);
    // No diagnosis was requested, so the report carries none rather than a fake.
    expect(rep.diagnosis).toBeNull();
  });

  it("returns a uniform 404 for an unknown report token", async () => {
    const r = await api("/api/public/assessment/report/deadbeefdeadbeefdeadbeefdeadbeef");
    expect(r.status).toBe(404);
  });

  it("strips en and em dashes from every persisted public string", async () => {
    // A public input is no more trusted than a model output: any en or em dash a
    // prospect types must be normalised to an ASCII hyphen at the write boundary,
    // so the database-wide long-dash sweep reads zero.
    const EN = "\u2013";
    const EM = "\u2014";
    const sub = await api("/api/public/assessment/submit", {
      method: "POST",
      body: {
        answers: STRONG_ANSWERS,
        qualification: QUALIFICATION,
        companyUrl: `https://acme${EN}corp-${RUN}.example/path${EN}x`,
      },
    });
    expect(sub.status).toBe(200);
    const submissionId = (sub.json as { submissionId: string }).submissionId;
    createdIds.push(submissionId);

    const contact = await api(`/api/public/assessment/submissions/${submissionId}/contact`, {
      method: "POST",
      body: {
        name: `Pat${EM}Lee`,
        email: `dash-${RUN}@example.com`,
        company: `Acme${EN}Co`,
      },
    });
    expect(contact.status).toBe(200);

    const rows = await db
      .select()
      .from(assessmentSubmissionsTable)
      .where(eq(assessmentSubmissionsTable.id, submissionId))
      .limit(1);
    const row = rows[0]!;
    const blob = JSON.stringify(row);
    // Not one long dash may reach the database from a public input.
    expect(blob.includes(EN)).toBe(false);
    expect(blob.includes(EM)).toBe(false);
    // The dash was normalised to an ASCII hyphen, not silently dropped. An en
    // dash collapses to a bare hyphen; an em dash widens to a spaced hyphen.
    expect(row.contactName).toBe("Pat - Lee");
    expect(row.contactCompany).toBe("Acme-Co");
    expect(row.companyUrl).toBe(`https://acme-corp-${RUN}.example/path-x`);
  });

  it("triggers the bounded diagnosis at most once under concurrent contact posts", async () => {
    // A .example host never resolves, so the runner degrades with no model spend.
    const sub = await api("/api/public/assessment/submit", {
      method: "POST",
      body: {
        answers: STRONG_ANSWERS,
        qualification: QUALIFICATION,
        companyUrl: `https://race-${RUN}.example`,
      },
    });
    const submissionId = (sub.json as { submissionId: string }).submissionId;
    createdIds.push(submissionId);

    // Fire two contact posts at once. Only the writer that wins the atomic
    // not_requested -> pending claim may request the (billable) diagnosis, so the
    // fire-once guarantee holds even under a duplicate concurrent submit.
    const [a, b] = await Promise.all([
      api(`/api/public/assessment/submissions/${submissionId}/contact`, {
        method: "POST",
        body: { email: `race1-${RUN}@example.com` },
      }),
      api(`/api/public/assessment/submissions/${submissionId}/contact`, {
        method: "POST",
        body: { email: `race2-${RUN}@example.com` },
      }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const requested = [
      (a.json as { diagnosisRequested: boolean }).diagnosisRequested,
      (b.json as { diagnosisRequested: boolean }).diagnosisRequested,
    ];
    // Exactly one of the two concurrent posts won the claim: never both, never none.
    expect(requested.filter((x) => x === true)).toHaveLength(1);
  });

  it("bounds the optional diagnosis and degrades to unavailable with no model spend", async () => {
    // A reserved .example domain never resolves, so the homepage fetch fails and
    // the runner degrades to unavailable BEFORE any model call: the cost bound.
    const sub = await api("/api/public/assessment/submit", {
      method: "POST",
      body: {
        answers: STRONG_ANSWERS,
        qualification: QUALIFICATION,
        companyUrl: `https://no-such-host-${RUN}.example`,
      },
    });
    const submissionId = (sub.json as { submissionId: string }).submissionId;
    createdIds.push(submissionId);

    const contact = await api(`/api/public/assessment/submissions/${submissionId}/contact`, {
      method: "POST",
      body: { email: `${RUN}-diag@example.com` },
    });
    expect(contact.status).toBe(200);
    const cBody = contact.json as { reportPath: string; diagnosisRequested: boolean };
    // A url was supplied, so the diagnosis is requested.
    expect(cBody.diagnosisRequested).toBe(true);
    const token = cBody.reportPath.split("/").pop() as string;

    // Poll the report until the fire-and-forget runner reaches a terminal state.
    let diagnosis: any = null;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const report = await api(`/api/public/assessment/report/${token}`);
      expect(report.status).toBe(200);
      diagnosis = (report.json as { report: any }).report.diagnosis;
      expect(diagnosis).not.toBeNull();
      if (["unavailable", "failed", "ready"].includes(diagnosis.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // The thin footprint degrades honestly: unavailable, no profile, no telemetry.
    expect(diagnosis.status).toBe("unavailable");
    expect(diagnosis.profile).toBeNull();
    expect(diagnosis.provenance).toBe("unavailable");
    expect(diagnosis.homepage?.ok).toBe(false);
  }, 30_000);
});
