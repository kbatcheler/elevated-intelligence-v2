import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDescriptor } from "../catalogue";
import type { ConnectorContext, DerivedSignalSet, ExtractionResult, ExtractionScope } from "../contract";
import {
  ConnectorThrottleError,
  googleAnalytics4Connector,
  hubspotConnector,
  quickbooksOnlineConnector,
  salesforceConnector,
  shopifyConnector,
  zendeskConnector,
} from "../index";
import { buildSignalSet, computeWindows, isoDate, isoDateTime } from "../providerSignals";
import { getConnector, IMPLEMENTED_CONNECTORS, isImplemented } from "../registry";

// A node:http stand-in for each provider API. Every connector speaks over the
// Node global fetch, so pointing its base URL at this loopback server exercises
// the real request, pagination, header, and parsing paths with no SDK and no
// network. Each test installs a handler; the server records every request so we
// can assert the credential travelled as a bearer (or Shopify) token and never
// in a query string.

const NOW = new Date("2026-06-22T00:00:00.000Z");
const W = computeWindows(NOW, 90);
const TOKEN = "tok-secret-credential-value";

interface Canned {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
}
interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization?: string;
  shopifyToken?: string;
  body: unknown;
}
type Handler = (ctx: {
  method: string;
  path: string;
  url: URL;
  query: Record<string, string>;
  body: unknown;
}) => Canned;

let server: Server;
let baseUrl = "";
let handler: Handler = () => ({ status: 404, json: { error: "no handler installed" } });
const requests: RecordedRequest[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const url = new URL(req.url ?? "/", baseUrl);
      const query = Object.fromEntries(url.searchParams.entries());
      requests.push({
        method: req.method ?? "GET",
        path: url.pathname,
        query,
        authorization:
          typeof req.headers["authorization"] === "string"
            ? req.headers["authorization"]
            : undefined,
        shopifyToken:
          typeof req.headers["x-shopify-access-token"] === "string"
            ? req.headers["x-shopify-access-token"]
            : undefined,
        body,
      });
      const out = handler({ method: req.method ?? "GET", path: url.pathname, url, query, body });
      res.writeHead(out.status ?? 200, { "content-type": "application/json", ...(out.headers ?? {}) });
      res.end(JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = "http://127.0.0.1:" + port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests.length = 0;
  handler = () => ({ status: 404, json: { error: "no handler installed" } });
});

const resolvedRefs: string[] = [];
function makeCtx(): ConnectorContext {
  return {
    async resolveSecret(ref: string): Promise<string> {
      resolvedRefs.push(ref);
      return TOKEN;
    },
    tokenize: (v: string) => "tok_" + v.length,
    now: () => NOW,
    log: () => {},
  };
}

function scope(connectorKey: string, config: Record<string, unknown>): ExtractionScope {
  return {
    tenantId: randomUUID(),
    connectorKey,
    authRef: "authref-" + connectorKey,
    config,
  };
}

function asSet(result: ExtractionResult): DerivedSignalSet {
  return "set" in result ? result.set : result;
}

function values(set: DerivedSignalSet): Record<string, number | number[]> {
  return Object.fromEntries(set.signals.map((s) => [s.key, s.value]));
}

describe("salesforce connector", () => {
  const config = { baseUrl: "", apiVersion: "v59.0", windowDays: 90, sampleLimit: 50 };
  const salesforceHandler: Handler = ({ url }) => {
    const q = url.searchParams.get("q") ?? "";
    if (q.includes("IsClosed = false")) {
      return {
        json: {
          records: [
            { attributes: { type: "AggregateResult" }, s: "Prospecting", c: 3, ca: 3, amt: 30000 },
            { attributes: { type: "AggregateResult" }, s: "Negotiation", c: 2, ca: 2, amt: 50000 },
          ],
        },
      };
    }
    if (q.includes("GROUP BY IsWon")) {
      return {
        json: {
          records: [
            { attributes: { type: "AggregateResult" }, w: true, c: 8, ca: 8, amt: 80000 },
            { attributes: { type: "AggregateResult" }, w: false, c: 2, ca: 2, amt: 12000 },
          ],
        },
      };
    }
    return {
      json: {
        records: [
          {
            attributes: {
              type: "Opportunity",
              url: "/services/data/v59.0/sobjects/Opportunity/0061t00000AAAAAAA",
            },
            CreatedDate: "2026-05-01T00:00:00.000Z",
            CloseDate: "2026-05-11T00:00:00.000Z",
          },
          {
            attributes: {
              type: "Opportunity",
              url: "/services/data/v59.0/sobjects/Opportunity/0061t00000BBBBBBB",
            },
            CreatedDate: "2026-05-02T00:00:00.000Z",
            CloseDate: "2026-05-22T00:00:00.000Z",
          },
        ],
      },
    };
  };

  it("derives the four crm signals from aggregate SOQL", async () => {
    handler = salesforceHandler;
    const set = asSet(
      await salesforceConnector.extractSignals(scope("salesforce", { ...config, baseUrl }), makeCtx()),
    );
    expect(set.source).toBe("salesforce");
    const v = values(set);
    expect(v.pipeline_coverage_ratio).toBeCloseTo(80000 / 80000);
    expect(v.win_rate_pct).toBeCloseTo(8 / 10);
    expect(v.sales_cycle_days).toBeCloseTo((10 + 20) / 2);
    expect(v.stage_distribution).toEqual([2, 3]);
  });

  it("omits pipeline_coverage_ratio when open opportunities carry no finite Amount, never a zero", async () => {
    handler = ({ url }) => {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("IsClosed = false")) {
        // Open opportunities exist (counts) but every Amount is null (ca 0).
        return {
          json: {
            records: [
              { s: "Prospecting", c: 3, ca: 0, amt: null },
              { s: "Negotiation", c: 2, ca: 0, amt: null },
            ],
          },
        };
      }
      if (q.includes("GROUP BY IsWon")) {
        return {
          json: {
            records: [
              { w: true, c: 8, ca: 8, amt: 80000 },
              { w: false, c: 2, ca: 2, amt: 12000 },
            ],
          },
        };
      }
      return { json: { records: [] } };
    };
    const set = asSet(
      await salesforceConnector.extractSignals(scope("salesforce", { ...config, baseUrl }), makeCtx()),
    );
    const v = values(set);
    // Coverage is unknown (open amount unobserved), not a fabricated zero.
    expect(v.pipeline_coverage_ratio).toBeUndefined();
    // Signals that do not depend on the open amount are unaffected.
    expect(v.win_rate_pct).toBeCloseTo(8 / 10);
    expect(v.stage_distribution).toEqual([2, 3]);
  });

  it("omits pipeline_coverage_ratio when only SOME open opportunities carry an Amount", async () => {
    handler = ({ url }) => {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("IsClosed = false")) {
        // One stage is fully populated (ca == c); another has counts but only a
        // partial set of Amounts (ca 1 of 3), so the summed pipeline is a partial
        // sum and the coverage figure would be understated.
        return {
          json: {
            records: [
              { s: "Negotiation", c: 2, ca: 2, amt: 40000 },
              { s: "Prospecting", c: 3, ca: 1, amt: 20000 },
            ],
          },
        };
      }
      if (q.includes("GROUP BY IsWon")) {
        return {
          json: {
            records: [
              { w: true, c: 8, ca: 8, amt: 80000 },
              { w: false, c: 2, ca: 2, amt: 12000 },
            ],
          },
        };
      }
      return { json: { records: [] } };
    };
    const set = asSet(
      await salesforceConnector.extractSignals(scope("salesforce", { ...config, baseUrl }), makeCtx()),
    );
    const v = values(set);
    // A partial open pipeline is unknown, not a fabricated (understated) figure.
    expect(v.pipeline_coverage_ratio).toBeUndefined();
    // Win rate and the stage distribution (built from counts) are unaffected.
    expect(v.win_rate_pct).toBeCloseTo(8 / 10);
    expect(v.stage_distribution).toEqual([2, 3]);
  });

  it("lets no opportunity id or stage label escape", async () => {
    handler = salesforceHandler;
    const set = asSet(
      await salesforceConnector.extractSignals(scope("salesforce", { ...config, baseUrl }), makeCtx()),
    );
    const json = JSON.stringify(set);
    expect(json).not.toContain("0061t00000");
    expect(json).not.toContain("Prospecting");
    expect(json).not.toContain("Negotiation");
  });

  it("resolves the credential by authRef and sends it as a bearer header", async () => {
    handler = salesforceHandler;
    resolvedRefs.length = 0;
    await salesforceConnector.extractSignals(scope("salesforce", { ...config, baseUrl }), makeCtx());
    expect(resolvedRefs).toContain("authref-salesforce");
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.authorization).toBe("Bearer " + TOKEN);
      expect(JSON.stringify(r.query)).not.toContain(TOKEN);
    }
  });

  it("raises a throttle signal carrying the Retry-After hint on http 429", async () => {
    handler = () => ({ status: 429, headers: { "retry-after": "7" }, json: {} });
    const err = await salesforceConnector
      .extractSignals(scope("salesforce", { ...config, baseUrl }), makeCtx())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectorThrottleError);
    expect((err as ConnectorThrottleError).retryAfterSeconds).toBe(7);
  });
});

describe("hubspot connector", () => {
  const hubspotHandler: Handler = ({ path, body }) => {
    if (!path.endsWith("/deals/search")) return { status: 404, json: {} };
    const after = (body as { after?: string } | undefined)?.after;
    if (!after) {
      return {
        json: {
          results: [
            {
              id: "deal-1001",
              properties: {
                dealstage: "appointmentscheduled",
                amount: "20000",
                createdate: "2026-05-01T00:00:00Z",
                hs_is_closed: "false",
                hs_is_closed_won: "false",
                email: "buyer@acme.example",
              },
            },
            {
              id: "deal-1002",
              properties: {
                dealstage: "closedwon",
                amount: "50000",
                createdate: "2026-04-01T00:00:00Z",
                closedate: "2026-04-21T00:00:00Z",
                hs_is_closed: "true",
                hs_is_closed_won: "true",
              },
            },
          ],
          paging: { next: { after: "page2" } },
        },
      };
    }
    return {
      json: {
        results: [
          {
            id: "deal-1003",
            properties: {
              dealstage: "closedlost",
              amount: "10000",
              createdate: "2026-03-01T00:00:00Z",
              closedate: "2026-03-15T00:00:00Z",
              hs_is_closed: "true",
              hs_is_closed_won: "false",
            },
          },
        ],
      },
    };
  };

  it("walks the paged deal search and derives the four crm signals", async () => {
    handler = hubspotHandler;
    const set = asSet(
      await hubspotConnector.extractSignals(scope("hubspot", { baseUrl, windowDays: 90 }), makeCtx()),
    );
    const v = values(set);
    expect(v.pipeline_coverage_ratio).toBeCloseTo(20000 / 50000);
    expect(v.win_rate_pct).toBeCloseTo(1 / 2);
    expect(v.sales_cycle_days).toBeCloseTo(20);
    expect(v.stage_distribution).toEqual([1]);
    // Two pages were requested.
    expect(requests.filter((r) => r.path.endsWith("/deals/search")).length).toBe(2);
  });

  it("omits pipeline_coverage_ratio when open deals carry no finite amount, never a zero", async () => {
    handler = () => ({
      json: {
        results: [
          {
            properties: {
              dealstage: "appointmentscheduled",
              createdate: "2026-05-01T00:00:00Z",
              hs_is_closed: "false",
              hs_is_closed_won: "false",
            },
          },
          {
            properties: {
              dealstage: "closedwon",
              amount: "50000",
              createdate: "2026-04-01T00:00:00Z",
              closedate: "2026-04-21T00:00:00Z",
              hs_is_closed: "true",
              hs_is_closed_won: "true",
            },
          },
        ],
      },
    });
    const set = asSet(
      await hubspotConnector.extractSignals(scope("hubspot", { baseUrl, windowDays: 90 }), makeCtx()),
    );
    const v = values(set);
    // Open deal exists but has no amount, so coverage is omitted not zeroed.
    expect(v.pipeline_coverage_ratio).toBeUndefined();
    expect(v.win_rate_pct).toBeCloseTo(1 / 1);
    expect(v.stage_distribution).toEqual([1]);
  });

  it("omits pipeline_coverage_ratio when only SOME open deals carry an amount", async () => {
    handler = () => ({
      json: {
        results: [
          {
            properties: {
              dealstage: "appointmentscheduled",
              amount: "20000",
              createdate: "2026-05-01T00:00:00Z",
              hs_is_closed: "false",
              hs_is_closed_won: "false",
            },
          },
          {
            // A second open deal with no amount: the pipeline total is a partial sum.
            properties: {
              dealstage: "qualifiedtobuy",
              createdate: "2026-05-02T00:00:00Z",
              hs_is_closed: "false",
              hs_is_closed_won: "false",
            },
          },
          {
            properties: {
              dealstage: "closedwon",
              amount: "50000",
              createdate: "2026-04-01T00:00:00Z",
              closedate: "2026-04-21T00:00:00Z",
              hs_is_closed: "true",
              hs_is_closed_won: "true",
            },
          },
        ],
      },
    });
    const set = asSet(
      await hubspotConnector.extractSignals(scope("hubspot", { baseUrl, windowDays: 90 }), makeCtx()),
    );
    const v = values(set);
    // One of two open deals lacks an amount, so coverage is unknown, not an
    // understated (partial-sum) figure.
    expect(v.pipeline_coverage_ratio).toBeUndefined();
    expect(v.win_rate_pct).toBeCloseTo(1 / 1);
    expect(v.stage_distribution).toEqual([1, 1]);
  });

  it("lets no deal id or contact email escape, and sends a bearer token", async () => {
    handler = hubspotHandler;
    resolvedRefs.length = 0;
    const set = asSet(
      await hubspotConnector.extractSignals(scope("hubspot", { baseUrl, windowDays: 90 }), makeCtx()),
    );
    const json = JSON.stringify(set);
    expect(json).not.toContain("deal-100");
    expect(json).not.toContain("@");
    expect(json).not.toContain("acme.example");
    expect(resolvedRefs).toContain("authref-hubspot");
    for (const r of requests) expect(r.authorization).toBe("Bearer " + TOKEN);
  });

  it("omits ALL four signals when the deal walk is truncated at maxRecords, never a partial-sample figure", async () => {
    // Every page reports a further page, but the cap stops the walk after one. The
    // aggregates would then describe an arbitrary slice of the window, so none is shown.
    handler = () => ({
      json: {
        results: [
          {
            properties: {
              dealstage: "closedwon",
              amount: "50000",
              createdate: "2026-05-01T00:00:00Z",
              closedate: "2026-05-21T00:00:00Z",
              hs_is_closed: "true",
              hs_is_closed_won: "true",
            },
          },
        ],
        paging: { next: { after: "next-cursor" } },
      },
    });
    const set = asSet(
      await hubspotConnector.extractSignals(
        scope("hubspot", { baseUrl, windowDays: 90, maxRecords: 1, pageSize: 1 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // A truncated population yields no honest aggregate: all four are omitted, not
    // computed from the single page that was read.
    expect(v.pipeline_coverage_ratio).toBeUndefined();
    expect(v.win_rate_pct).toBeUndefined();
    expect(v.sales_cycle_days).toBeUndefined();
    expect(v.stage_distribution).toBeUndefined();
  });
});

describe("quickbooks-online connector", () => {
  const REALM = "9130350000";
  function pl(income: number, gross: number, expenses: number): unknown {
    return {
      Rows: {
        Row: [
          { group: "Income", Summary: { ColData: [{ value: "Total Income" }, { value: String(income) }] } },
          { group: "GrossProfit", Summary: { ColData: [{ value: "Gross Profit" }, { value: String(gross) }] } },
          { group: "Expenses", Summary: { ColData: [{ value: "Total Expenses" }, { value: String(expenses) }] } },
        ],
      },
    };
  }
  const qboHandler: Handler = ({ path, url }) => {
    if (path.endsWith("/reports/ProfitAndLoss")) {
      const start = url.searchParams.get("start_date") ?? "";
      if (start === isoDate(W.start)) return { json: pl(100000, 60000, 30000) };
      return { json: pl(80000, 48000, 24000) };
    }
    if (path.endsWith("/reports/AgedReceivables")) {
      return {
        json: {
          Rows: {
            Row: [
              { type: "Data", ColData: [{ value: "Acme Industries Ltd" }, { value: "15000" }] },
              { type: "Data", ColData: [{ value: "Globex Corporation" }, { value: "10000" }] },
            ],
          },
        },
      };
    }
    return { status: 404, json: {} };
  };

  it("reduces the report totals to the four accounting signals", async () => {
    handler = qboHandler;
    const set = asSet(
      await quickbooksOnlineConnector.extractSignals(
        scope("quickbooks-online", { baseUrl, realmId: REALM, windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    expect(v.gross_margin_pct).toBeCloseTo(60000 / 100000);
    expect(v.expense_ratio).toBeCloseTo(30000 / 100000);
    expect(v.revenue_trend_delta).toBeCloseTo((100000 - 80000) / 80000);
    expect(v.ar_days_outstanding).toBeCloseTo((25000 * 90) / 100000);
  });

  it("lets no customer name or realm id escape", async () => {
    handler = qboHandler;
    const set = asSet(
      await quickbooksOnlineConnector.extractSignals(
        scope("quickbooks-online", { baseUrl, realmId: REALM, windowDays: 90 }),
        makeCtx(),
      ),
    );
    const json = JSON.stringify(set);
    expect(json).not.toContain("Acme Industries");
    expect(json).not.toContain("Globex");
    expect(json).not.toContain(REALM);
  });

  it("omits ar_days_outstanding when the receivables report is missing, never a zero", async () => {
    handler = ({ path, url }) => {
      if (path.endsWith("/reports/ProfitAndLoss")) {
        const start = url.searchParams.get("start_date") ?? "";
        if (start === isoDate(W.start)) return { json: pl(100000, 60000, 30000) };
        return { json: pl(80000, 48000, 24000) };
      }
      // A missing or malformed Aged Receivables report (no Rows at all).
      if (path.endsWith("/reports/AgedReceivables")) return { json: {} };
      return { status: 404, json: {} };
    };
    const set = asSet(
      await quickbooksOnlineConnector.extractSignals(
        scope("quickbooks-online", { baseUrl, realmId: REALM, windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // The receivables signal is honestly absent, not a fabricated zero.
    expect(v.ar_days_outstanding).toBeUndefined();
    // The three P&L-derived signals are unaffected and still present.
    expect(v.gross_margin_pct).toBeCloseTo(60000 / 100000);
    expect(v.expense_ratio).toBeCloseTo(30000 / 100000);
    expect(v.revenue_trend_delta).toBeCloseTo((100000 - 80000) / 80000);
  });

  it("omits ar_days_outstanding when ONLY SOME customer lines carry a finite total, never a partial sum", async () => {
    handler = ({ path, url }) => {
      if (path.endsWith("/reports/ProfitAndLoss")) {
        const start = url.searchParams.get("start_date") ?? "";
        if (start === isoDate(W.start)) return { json: pl(100000, 60000, 30000) };
        return { json: pl(80000, 48000, 24000) };
      }
      if (path.endsWith("/reports/AgedReceivables")) {
        return {
          json: {
            Rows: {
              Row: [
                // One real customer line with a finite trailing total...
                { type: "Data", ColData: [{ value: "Acme Industries Ltd" }, { value: "15000" }] },
                // ...and one customer line whose trailing total is missing. Summing
                // only the first would understate receivables, so the figure is omitted.
                { type: "Data", ColData: [{ value: "Globex Corporation" }, { value: "" }] },
              ],
            },
          },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await quickbooksOnlineConnector.extractSignals(
        scope("quickbooks-online", { baseUrl, realmId: REALM, windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // A partial receivables sum is never shown as an understated figure.
    expect(v.ar_days_outstanding).toBeUndefined();
    // The P&L-derived signals are unaffected and still present.
    expect(v.gross_margin_pct).toBeCloseTo(60000 / 100000);
    expect(v.expense_ratio).toBeCloseTo(30000 / 100000);
    expect(v.revenue_trend_delta).toBeCloseTo((100000 - 80000) / 80000);
  });

  it("omits ar_days_outstanding when a NESTED receivables section is wholly malformed, beside a finite sibling", async () => {
    handler = ({ path, url }) => {
      if (path.endsWith("/reports/ProfitAndLoss")) {
        const start = url.searchParams.get("start_date") ?? "";
        if (start === isoDate(W.start)) return { json: pl(100000, 60000, 30000) };
        return { json: pl(80000, 48000, 24000) };
      }
      if (path.endsWith("/reports/AgedReceivables")) {
        return {
          json: {
            Rows: {
              Row: [
                // A finite sibling leaf at the top level...
                { type: "Data", ColData: [{ value: "Acme Industries Ltd" }, { value: "15000" }] },
                // ...next to an ageing band whose only customer line has no finite
                // total. The malformed nested section must propagate incompleteness
                // rather than be silently dropped behind the finite sibling.
                {
                  Header: { ColData: [{ value: "91 and over" }] },
                  Rows: {
                    Row: [{ type: "Data", ColData: [{ value: "Globex Corporation" }, { value: "" }] }],
                  },
                },
              ],
            },
          },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await quickbooksOnlineConnector.extractSignals(
        scope("quickbooks-online", { baseUrl, realmId: REALM, windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // Incompleteness from a nested section propagates: the figure is omitted, never
    // an understated total formed only from the finite sibling.
    expect(v.ar_days_outstanding).toBeUndefined();
    expect(v.gross_margin_pct).toBeCloseTo(60000 / 100000);
    expect(v.expense_ratio).toBeCloseTo(30000 / 100000);
  });
});

describe("google-analytics-4 connector", () => {
  const PROPERTY = "123456789";
  const ga4Handler: Handler = ({ path, body }) => {
    if (!path.endsWith(":runReport")) return { status: 404, json: {} };
    const hasDim = Array.isArray((body as { dimensions?: unknown[] } | undefined)?.dimensions);
    if (hasDim) {
      return {
        json: {
          rows: [
            { dimensionValues: [{ value: "Organic Search" }], metricValues: [{ value: "600" }] },
            { dimensionValues: [{ value: "Paid Search" }], metricValues: [{ value: "400" }] },
          ],
          totals: [
            {
              metricValues: [{ value: "1000" }, { value: "100" }, { value: "0.5" }, { value: "2000" }],
            },
          ],
        },
      };
    }
    return { json: { totals: [{ metricValues: [{ value: "1500" }, { value: "50" }] }] } };
  };

  it("derives the four marketing signals from runReport totals", async () => {
    handler = ga4Handler;
    const set = asSet(
      await googleAnalytics4Connector.extractSignals(
        scope("google-analytics-4", { baseUrl, propertyId: PROPERTY, windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    expect(v.conversion_rate_pct).toBeCloseTo(100 / 1000);
    expect(v.engagement_index).toBeCloseTo(0.5);
    expect(v.channel_mix_distribution).toEqual([600, 400]);
    expect(v.cac_trend_delta).toBeCloseTo((2000 / 100 - 1500 / 50) / (1500 / 50));
  });

  it("lets no channel label or property id escape", async () => {
    handler = ga4Handler;
    const set = asSet(
      await googleAnalytics4Connector.extractSignals(
        scope("google-analytics-4", { baseUrl, propertyId: PROPERTY, windowDays: 90 }),
        makeCtx(),
      ),
    );
    const json = JSON.stringify(set);
    expect(json).not.toContain("Organic Search");
    expect(json).not.toContain("Paid Search");
    expect(json).not.toContain(PROPERTY);
  });
});

describe("shopify connector", () => {
  const shopifyHandler: Handler = ({ path, query }) => {
    if (path.endsWith("/orders.json")) {
      if (query.page_info === "PAGE2") {
        return { json: { orders: [{ total_price: "150.00", line_items: [{ quantity: 3 }] }] } };
      }
      if (query.created_at_min === isoDateTime(W.start)) {
        const next =
          "<" +
          baseUrl +
          "/admin/api/2024-07/orders.json?limit=250&page_info=PAGE2>; rel=\"next\"";
        return {
          headers: { link: next },
          json: {
            orders: [
              {
                total_price: "250.00",
                line_items: [{ quantity: 5, title: "Secret Widget", product_id: 99001 }],
              },
            ],
          },
        };
      }
      return {
        json: {
          orders: [
            { total_price: "200.00", line_items: [{ quantity: 2 }] },
            { total_price: "100.00", line_items: [{ quantity: 1 }] },
          ],
        },
      };
    }
    if (path.endsWith("/products.json")) {
      return {
        json: {
          products: [
            {
              variants: [
                { inventory_quantity: 10 },
                { inventory_quantity: 0 },
                { inventory_quantity: 5 },
              ],
            },
          ],
        },
      };
    }
    return { status: 404, json: {} };
  };

  it("follows Link pagination and derives the four commerce signals", async () => {
    handler = shopifyHandler;
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    expect(v.sell_through_rate_pct).toBeCloseTo(8 / (8 + 15));
    expect(v.inventory_turns).toBeCloseTo(8 / 15);
    expect(v.aov_trend_delta).toBeCloseTo((400 / 2 - 300 / 2) / (300 / 2));
    expect(v.stockout_ratio).toBeCloseTo(1 / 3);
    // The current-window order feed was followed across two pages.
    expect(requests.filter((r) => r.query.page_info === "PAGE2").length).toBe(1);
  });

  it("sends the Shopify token header (not a query string) and lets no product title or id escape", async () => {
    handler = shopifyHandler;
    resolvedRefs.length = 0;
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const json = JSON.stringify(set);
    expect(json).not.toContain("Secret Widget");
    expect(json).not.toContain("99001");
    expect(resolvedRefs).toContain("authref-shopify");
    for (const r of requests) {
      expect(r.shopifyToken).toBe(TOKEN);
      expect(r.authorization).toBeUndefined();
      expect(JSON.stringify(r.query)).not.toContain(TOKEN);
    }
  });

  it("omits the inventory signals when the product feed is empty, never a fabricated sell-through", async () => {
    handler = (hctx) => {
      // An empty inventory feed: no variants observed at all.
      if (hctx.path.endsWith("/products.json")) return { json: { products: [] } };
      return shopifyHandler(hctx);
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // Without observed inventory, the three inventory-derived signals are absent
    // rather than fabricated (a missing onHand must not imply a perfect sell-through).
    expect(v.sell_through_rate_pct).toBeUndefined();
    expect(v.inventory_turns).toBeUndefined();
    expect(v.stockout_ratio).toBeUndefined();
    // The order-derived trend signal is unaffected and still present.
    expect(v.aov_trend_delta).toBeCloseTo((400 / 2 - 300 / 2) / (300 / 2));
  });

  it("omits aov_trend_delta when orders carry no finite total_price, never a zero", async () => {
    handler = ({ path }) => {
      // Orders exist (and have quantities) but no order carries a total_price.
      if (path.endsWith("/orders.json")) {
        return { json: { orders: [{ line_items: [{ quantity: 2 }] }] } };
      }
      if (path.endsWith("/products.json")) {
        return {
          json: { products: [{ variants: [{ inventory_quantity: 10 }, { inventory_quantity: 0 }] }] },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // AOV cannot be formed without a price, so its trend is omitted not zeroed.
    expect(v.aov_trend_delta).toBeUndefined();
    // Units and inventory were observed, so these remain present.
    expect(v.sell_through_rate_pct).toBeCloseTo(2 / (2 + 10));
    expect(v.inventory_turns).toBeCloseTo(2 / 10);
    expect(v.stockout_ratio).toBeCloseTo(1 / 2);
  });

  it("omits sell-through and turns when line items carry no finite quantity, never a zero", async () => {
    handler = ({ path }) => {
      // Orders are priced, but line-item quantity is absent.
      if (path.endsWith("/orders.json")) {
        return { json: { orders: [{ total_price: "200.00", line_items: [{}] }] } };
      }
      if (path.endsWith("/products.json")) {
        return {
          json: { products: [{ variants: [{ inventory_quantity: 10 }, { inventory_quantity: 0 }] }] },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // Units sold unknown, so the two units-dependent signals are omitted.
    expect(v.sell_through_rate_pct).toBeUndefined();
    expect(v.inventory_turns).toBeUndefined();
    // AOV (price observed, equal across windows) and stockout are unaffected.
    expect(v.aov_trend_delta).toBeCloseTo(0);
    expect(v.stockout_ratio).toBeCloseTo(1 / 2);
  });

  it("omits inventory signals when variants carry no finite inventory_quantity, never a zero", async () => {
    handler = ({ path }) => {
      if (path.endsWith("/orders.json")) {
        return { json: { orders: [{ total_price: "200.00", line_items: [{ quantity: 4 }] }] } };
      }
      // Variants exist, but none carries a finite inventory_quantity.
      if (path.endsWith("/products.json")) {
        return { json: { products: [{ variants: [{}, {}] }] } };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // On-hand unknown for every variant: the three inventory-derived signals are
    // omitted, never a fabricated perfect sell-through or full-stock figure.
    expect(v.sell_through_rate_pct).toBeUndefined();
    expect(v.inventory_turns).toBeUndefined();
    expect(v.stockout_ratio).toBeUndefined();
    // The order-derived trend remains present (equal across windows).
    expect(v.aov_trend_delta).toBeCloseTo(0);
  });

  it("omits aov_trend_delta when only SOME orders carry a total_price, never a partial AOV", async () => {
    handler = ({ path }) => {
      // Two orders per window: one priced, one unpriced. AOV would be a partial
      // sum over a full order count, so it (and its trend) must be omitted.
      if (path.endsWith("/orders.json")) {
        return {
          json: {
            orders: [
              { total_price: "250.00", line_items: [{ quantity: 5 }] },
              { line_items: [{ quantity: 3 }] },
            ],
          },
        };
      }
      if (path.endsWith("/products.json")) {
        return {
          json: {
            products: [
              { variants: [{ inventory_quantity: 10 }, { inventory_quantity: 0 }, { inventory_quantity: 5 }] },
            ],
          },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // AOV is unknown (a partial revenue sum), so its trend is omitted not zeroed.
    expect(v.aov_trend_delta).toBeUndefined();
    // Units (every line item quantified) and complete inventory are unaffected.
    expect(v.sell_through_rate_pct).toBeCloseTo(8 / (8 + 15));
    expect(v.inventory_turns).toBeCloseTo(8 / 15);
    expect(v.stockout_ratio).toBeCloseTo(1 / 3);
  });

  it("omits sell-through and turns when only SOME line items carry a quantity", async () => {
    handler = ({ path }) => {
      // The order is priced, but one of its two line items has no quantity, so the
      // units total is a partial sum.
      if (path.endsWith("/orders.json")) {
        return { json: { orders: [{ total_price: "200.00", line_items: [{ quantity: 4 }, {}] }] } };
      }
      if (path.endsWith("/products.json")) {
        return {
          json: { products: [{ variants: [{ inventory_quantity: 10 }, { inventory_quantity: 0 }] }] },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // Units sold is a partial sum, so the two units-dependent signals are omitted.
    expect(v.sell_through_rate_pct).toBeUndefined();
    expect(v.inventory_turns).toBeUndefined();
    // AOV (every order priced, equal across windows) and stockout are unaffected.
    expect(v.aov_trend_delta).toBeCloseTo(0);
    expect(v.stockout_ratio).toBeCloseTo(1 / 2);
  });

  it("omits the order-derived signals when the order walk is truncated at maxRecords", async () => {
    // Each window's order feed reports a further page, but the cap stops after one,
    // so the revenue and unit sums are partial and their figures must be omitted.
    handler = ({ path, query }) => {
      if (path.endsWith("/orders.json")) {
        if (query.page_info === "PAGE2") {
          return { json: { orders: [{ total_price: "10.00", line_items: [{ quantity: 1 }] }] } };
        }
        const next =
          "<" + baseUrl + "/admin/api/2024-07/orders.json?limit=1&page_info=PAGE2>; rel=\"next\"";
        return {
          headers: { link: next },
          json: { orders: [{ total_price: "250.00", line_items: [{ quantity: 5 }] }] },
        };
      }
      if (path.endsWith("/products.json")) {
        // A complete, single-page catalogue (no Link header): inventory is unaffected.
        return {
          json: {
            products: [
              { variants: [{ inventory_quantity: 10 }, { inventory_quantity: 0 }, { inventory_quantity: 5 }] },
            ],
          },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90, maxRecords: 1, pageSize: 1 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // Truncated order feed: revenue and units are partial, so AOV trend, sell-through
    // and turns are omitted, never understated.
    expect(v.aov_trend_delta).toBeUndefined();
    expect(v.sell_through_rate_pct).toBeUndefined();
    expect(v.inventory_turns).toBeUndefined();
    // Inventory was walked in full, so stockout remains an honest observed-variant figure.
    expect(v.stockout_ratio).toBeCloseTo(1 / 3);
  });

  it("omits the inventory signals when the product walk is truncated at maxRecords", async () => {
    handler = ({ path, query }) => {
      if (path.endsWith("/orders.json")) {
        // Complete, single-page order feed per window (no Link header).
        if (query.created_at_min === isoDateTime(W.start)) {
          return { json: { orders: [{ total_price: "200.00", line_items: [{ quantity: 2 }] }] } };
        }
        return { json: { orders: [{ total_price: "100.00", line_items: [{ quantity: 1 }] }] } };
      }
      if (path.endsWith("/products.json")) {
        if (query.page_info === "PAGE2") {
          return { json: { products: [{ variants: [{ inventory_quantity: 7 }] }] } };
        }
        const next =
          "<" + baseUrl + "/admin/api/2024-07/products.json?limit=1&page_info=PAGE2>; rel=\"next\"";
        return {
          headers: { link: next },
          json: { products: [{ variants: [{ inventory_quantity: 10 }, { inventory_quantity: 0 }] }] },
        };
      }
      return { status: 404, json: {} };
    };
    const set = asSet(
      await shopifyConnector.extractSignals(
        scope("shopify", { baseUrl, apiVersion: "2024-07", windowDays: 90, maxRecords: 1, pageSize: 1 }),
        makeCtx(),
      ),
    );
    const v = values(set);
    // Truncated catalogue: every inventory-derived figure is omitted, including the
    // observed-variant stockout sample, which can no longer claim to cover the catalogue.
    expect(v.stockout_ratio).toBeUndefined();
    expect(v.sell_through_rate_pct).toBeUndefined();
    expect(v.inventory_turns).toBeUndefined();
    // The order feed was complete, so the AOV trend remains present.
    expect(v.aov_trend_delta).toBeCloseTo((200 - 100) / 100);
  });
});

describe("zendesk connector", () => {
  const zendeskHandler: Handler = ({ path, query }) => {
    if (path.endsWith("/search/count.json")) {
      const q = query.query ?? "";
      if (q.includes("satisfaction:good")) return { json: { count: 30 } };
      if (q.includes("satisfaction:bad")) return { json: { count: 6 } };
      if (q.includes("status:solved")) return { json: { count: 70 } };
      if (q.includes("created<")) return { json: { count: 80 } };
      return { json: { count: 100 } };
    }
    if (path.endsWith("/ticket_metrics.json")) {
      return {
        json: {
          ticket_metrics: [
            {
              reply_time_in_minutes: { calendar: 120 },
              ticket_id: "tkt-555",
              assignee: "agent@acme.example",
            },
            { reply_time_in_minutes: { calendar: 60 } },
          ],
        },
      };
    }
    return { status: 404, json: {} };
  };

  it("derives the four support signals from server-side counts and a bounded sample", async () => {
    handler = zendeskHandler;
    const set = asSet(
      await zendeskConnector.extractSignals(scope("zendesk", { baseUrl, windowDays: 90 }), makeCtx()),
    );
    const v = values(set);
    expect(v.csat_index).toBeCloseTo(30 / (30 + 6));
    expect(v.first_response_hours).toBeCloseTo((120 / 60 + 60 / 60) / 2);
    expect(v.ticket_volume_trend_delta).toBeCloseTo((100 - 80) / 80);
    expect(v.resolution_rate_pct).toBeCloseTo(70 / 100);
  });

  it("lets no ticket id or requester email escape", async () => {
    handler = zendeskHandler;
    const set = asSet(
      await zendeskConnector.extractSignals(scope("zendesk", { baseUrl, windowDays: 90 }), makeCtx()),
    );
    const json = JSON.stringify(set);
    expect(json).not.toContain("tkt-555");
    expect(json).not.toContain("@");
  });
});

describe("signal allowlist guard", () => {
  // buildSignalSet must reject any draft whose key the connector did not declare
  // in the catalogue, so a renamed or stray signal fails loudly at the boundary
  // rather than leaking an unexpected key into a derived set.
  it("rejects a draft whose key the connector did not declare", () => {
    expect(() =>
      buildSignalSet({
        source: "salesforce",
        scope: scope("salesforce", {}),
        ctx: makeCtx(),
        drafts: [{ key: "totally_undeclared_signal", kind: "ratio", value: 0.5 }],
      }),
    ).toThrow(/Undeclared signal key/);
  });

  it("admits a declared key for the same connector", () => {
    const set = buildSignalSet({
      source: "salesforce",
      scope: scope("salesforce", {}),
      ctx: makeCtx(),
      drafts: [{ key: "win_rate_pct", kind: "ratio", value: 0.5 }],
    });
    expect(set.signals.map((s) => s.key)).toEqual(["win_rate_pct"]);
  });
});

describe("registry integration", () => {
  const priorityKeys = [
    "salesforce",
    "hubspot",
    "quickbooks-online",
    "google-analytics-4",
    "shopify",
    "zendesk",
  ];

  it("marks, registers, and resolves all six priority connectors", () => {
    for (const key of priorityKeys) {
      expect(getDescriptor(key)?.implemented).toBe(true);
      expect(isImplemented(key)).toBe(true);
      expect(getConnector(key).key).toBe(key);
    }
  });

  it("leaves the warehouse pair and the rest of the catalogue untouched", () => {
    expect(isImplemented("generic-sql")).toBe(true);
    expect(isImplemented("redshift")).toBe(true);
    // The two warehouse connectors plus the six priority connectors, and nothing
    // else flipped to implemented.
    expect(IMPLEMENTED_CONNECTORS.length).toBe(8);
    // A declared-only connector is still honestly "available, not connected".
    expect(isImplemented("xero")).toBe(false);
    expect(getDescriptor("xero")?.implemented).toBe(false);
    expect(() => getConnector("xero")).toThrow(/available, not connected/);
  });
});
