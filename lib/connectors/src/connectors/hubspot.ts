import { z } from "zod/v4";
import { httpJson } from "../httpJson";
import {
  buildConnector,
  buildSignalSet,
  computeWindows,
  daysBetweenTs,
  distributionByLabel,
  mean,
  parseTimestamp,
  safeRatio,
  toNumber,
  windowLabel,
  type SignalDraft,
} from "../providerSignals";

// HubSpot CRM (crm-sales). Runs in the in-client edge agent. It reduces a bounded
// page walk of deal PROPERTIES (stage, amount, created and close dates, the
// closed and closed-won flags) into the four declared crm-sales signals. It never
// reads a deal id, an associated contact, or any name or email; only the
// non-identifying numeric and date properties are touched, and the rows are
// discarded in memory.

const KEY = "hubspot";

const configSchema = z.object({
  baseUrl: z.string().url().default("https://api.hubapi.com"),
  windowDays: z.number().int().positive().max(3650).default(90),
  pageSize: z.number().int().positive().max(100).default(100),
  maxRecords: z.number().int().positive().max(50_000).default(2000),
});

interface HsSearchResponse {
  results?: Array<{ properties?: Record<string, unknown> }>;
  paging?: { next?: { after?: string } };
}

export const hubspotConnector = buildConnector(KEY, async (scope, ctx) => {
  const parsed = configSchema.safeParse(scope.config ?? {});
  if (!parsed.success) {
    throw new Error(
      "hubspot connector configuration invalid: " +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const cfg = parsed.data;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const token = await ctx.resolveSecret(scope.authRef);
  const headers = { authorization: "Bearer " + token };
  const searchUrl = base + "/crm/v3/objects/deals/search";
  const days = cfg.windowDays;
  const since = computeWindows(ctx.now(), days).start.getTime();

  const stageCounts = new Map<string, number>();
  let openPipeline = 0;
  let openCount = 0;
  let openAmountCount = 0;
  let wonCount = 0;
  let wonAmountCount = 0;
  let lostCount = 0;
  let wonAmount = 0;
  const cycleDays: number[] = [];

  let after: string | undefined;
  let fetched = 0;
  let truncated = false;
  for (let page = 0; page < 500; page++) {
    const body = {
      limit: cfg.pageSize,
      ...(after ? { after } : {}),
      properties: ["dealstage", "amount", "createdate", "closedate", "hs_is_closed", "hs_is_closed_won"],
      filterGroups: [
        { filters: [{ propertyName: "createdate", operator: "GTE", value: String(since) }] },
      ],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    };
    const res = await httpJson<HsSearchResponse>(searchUrl, { method: "POST", headers, body });
    const results = res.results ?? [];
    for (const row of results) {
      const p = row.properties ?? {};
      const amount = toNumber(p.amount);
      const stage = typeof p.dealstage === "string" ? p.dealstage : "";
      const isClosed = p.hs_is_closed === "true" || p.hs_is_closed === true;
      const isWon = p.hs_is_closed_won === "true" || p.hs_is_closed_won === true;
      if (!isClosed) {
        openCount += 1;
        if (stage) stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
        if (Number.isFinite(amount)) {
          openPipeline += amount;
          openAmountCount += 1;
        }
      } else if (isWon) {
        wonCount += 1;
        if (Number.isFinite(amount)) {
          wonAmount += amount;
          wonAmountCount += 1;
        }
        const d = daysBetweenTs(parseTimestamp(p.createdate), parseTimestamp(p.closedate));
        if (Number.isFinite(d) && d >= 0) cycleDays.push(d);
      } else {
        lostCount += 1;
      }
      fetched += 1;
    }
    after = res.paging?.next?.after;
    if (!after || results.length === 0) break;
    if (fetched >= cfg.maxRecords) {
      // The cap was reached while the provider still has further pages: every
      // population aggregate below would be computed over an arbitrary partial
      // sample of the window, so all four are omitted rather than understated.
      truncated = true;
      break;
    }
  }

  // Coverage requires completeness, not mere presence: every counted open deal
  // must carry a finite amount, and every won deal (the denominator) likewise. A
  // partial sum understates the figure, so coverage is omitted rather than
  // fabricated from it. No open deals at all stays a true zero.
  const openComplete = openAmountCount >= openCount;
  const wonAmountComplete = wonAmountCount >= wonCount;
  const openPipelineValue = openCount > 0 && !openComplete ? null : openPipeline;
  // When the deal walk was truncated at maxRecords, every aggregate below covers
  // only an arbitrary partial sample of the window, so none of the four is shown.
  const fullyWalked = !truncated;
  const window = windowLabel(days);
  const drafts: SignalDraft[] = [
    {
      key: "pipeline_coverage_ratio",
      kind: "ratio",
      value:
        !fullyWalked || openPipelineValue === null || !wonAmountComplete
          ? null
          : safeRatio(openPipelineValue, wonAmount),
      window,
    },
    {
      key: "win_rate_pct",
      kind: "ratio",
      value: fullyWalked ? safeRatio(wonCount, wonCount + lostCount) : null,
      window,
    },
    { key: "sales_cycle_days", kind: "aggregate", value: fullyWalked ? mean(cycleDays) : null, unit: "days", window },
    {
      key: "stage_distribution",
      kind: "distribution",
      value: fullyWalked ? distributionByLabel(stageCounts) : null,
    },
  ];

  ctx.log("hubspot.extract.complete", {
    connector: KEY,
    signals: drafts.filter((d) => d.value !== null).length,
  });
  return buildSignalSet({ source: KEY, scope, ctx, drafts });
});
