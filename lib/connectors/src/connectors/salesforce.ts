import { z } from "zod/v4";
import { httpJson } from "../httpJson";
import {
  buildConnector,
  buildSignalSet,
  daysBetweenTs,
  distributionByLabel,
  mean,
  parseTimestamp,
  safeRatio,
  toNumber,
  windowLabel,
  type SignalDraft,
} from "../providerSignals";

// Salesforce (crm-sales). Runs in the in-client edge agent. It computes its four
// declared signals from Salesforce SOQL aggregate queries (GROUP BY counts and
// sums) plus one bounded, date-only projection for the sales cycle. No
// Opportunity name, owner, account, or id is ever read into a signal; the
// extraction reduces to math in memory and the boundary guard rejects anything
// reversible.

const KEY = "salesforce";

const configSchema = z
  .object({
    // The org instance URL. baseUrl is accepted as an explicit override (and for
    // tests); instanceUrl is the field a connected app records.
    baseUrl: z.string().url().optional(),
    instanceUrl: z.string().url().optional(),
    apiVersion: z
      .string()
      .regex(/^v\d+\.\d+$/, "apiVersion must look like v59.0")
      .default("v59.0"),
    windowDays: z.number().int().positive().max(3650).default(90),
    // The bounded cap on the date-only sales-cycle projection.
    sampleLimit: z.number().int().positive().max(2000).default(200),
  })
  .refine((c) => Boolean(c.baseUrl ?? c.instanceUrl), {
    message: "salesforce connector requires baseUrl or instanceUrl in scope.config",
  });

interface SoqlResponse {
  records?: Array<Record<string, unknown>>;
}

export const salesforceConnector = buildConnector(KEY, async (scope, ctx) => {
  const parsed = configSchema.safeParse(scope.config ?? {});
  if (!parsed.success) {
    throw new Error(
      "salesforce connector configuration invalid: " +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const cfg = parsed.data;
  const base = (cfg.baseUrl ?? (cfg.instanceUrl as string)).replace(/\/+$/, "");
  const token = await ctx.resolveSecret(scope.authRef);
  const headers = { authorization: "Bearer " + token };
  const queryUrl = base + "/services/data/" + cfg.apiVersion + "/query";
  const days = cfg.windowDays;

  // COUNT(Amount) rides alongside COUNT(Id) so completeness is provable: an
  // aggregate SUM(Amount) can be finite while some opportunities in the group
  // carried a null Amount, so the count of populated Amounts is what tells us the
  // pipeline total is whole rather than a partial sum.
  const openSoql =
    "SELECT StageName s, COUNT(Id) c, COUNT(Amount) ca, SUM(Amount) amt FROM Opportunity " +
    "WHERE IsClosed = false GROUP BY StageName";
  const closedSoql =
    "SELECT IsWon w, COUNT(Id) c, COUNT(Amount) ca, SUM(Amount) amt FROM Opportunity " +
    "WHERE IsClosed = true AND CloseDate = LAST_N_DAYS:" +
    days +
    " GROUP BY IsWon";
  const cycleSoql =
    "SELECT CreatedDate, CloseDate FROM Opportunity " +
    "WHERE IsWon = true AND CloseDate = LAST_N_DAYS:" +
    days +
    " ORDER BY CloseDate DESC LIMIT " +
    cfg.sampleLimit;

  const [open, closed, cycle] = await Promise.all([
    httpJson<SoqlResponse>(queryUrl, { headers, query: { q: openSoql } }),
    httpJson<SoqlResponse>(queryUrl, { headers, query: { q: closedSoql } }),
    httpJson<SoqlResponse>(queryUrl, { headers, query: { q: cycleSoql } }),
  ]);

  // Open pipeline: count per stage (for the distribution), the populated-Amount
  // count, and the summed amount.
  const stageCounts = new Map<string, number>();
  let openPipeline = 0;
  let openIdTotal = 0;
  let openAmountTotal = 0;
  for (const r of open.records ?? []) {
    const stage = typeof r.s === "string" ? r.s : "";
    const count = toNumber(r.c);
    if (stage && Number.isFinite(count)) {
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + count);
    }
    if (Number.isFinite(count)) openIdTotal += count;
    const amtCount = toNumber(r.ca);
    if (Number.isFinite(amtCount)) openAmountTotal += amtCount;
    const amt = toNumber(r.amt);
    if (Number.isFinite(amt)) openPipeline += amt;
  }
  // Coverage requires a COMPLETE open pipeline: every counted open opportunity
  // must carry a finite Amount (COUNT(Amount) equals COUNT(Id)). If any open
  // opportunity lacks one, the summed pipeline is understated and therefore
  // unknown, so coverage is omitted rather than fabricated from a partial sum. A
  // genuinely empty pipeline (no open opportunities) stays a true zero.
  const openAmountComplete = openAmountTotal >= openIdTotal;
  const openPipelineValue = openIdTotal > 0 && !openAmountComplete ? null : openPipeline;

  // Closed pipeline within the window: won and lost counts, won amount, and the
  // populated-Amount count for the won group (the coverage denominator).
  let wonCount = 0;
  let lostCount = 0;
  let wonAmount = 0;
  let wonIdTotal = 0;
  let wonAmountTotal = 0;
  for (const r of closed.records ?? []) {
    const won = r.w === true || r.w === "true";
    const count = toNumber(r.c);
    if (!Number.isFinite(count)) continue;
    if (won) {
      wonCount += count;
      wonIdTotal += count;
      const amtCount = toNumber(r.ca);
      if (Number.isFinite(amtCount)) wonAmountTotal += amtCount;
      const amt = toNumber(r.amt);
      if (Number.isFinite(amt)) wonAmount += amt;
    } else {
      lostCount += count;
    }
  }
  // The coverage denominator (won amount) must likewise be complete: if any won
  // opportunity lacks a finite Amount the denominator is understated and coverage
  // would be overstated, so it too is omitted rather than fabricated.
  const wonAmountComplete = wonAmountTotal >= wonIdTotal;

  // Sales cycle: average days from creation to close over the bounded projection
  // of won opportunities. Only the two date columns are read; the rows are then
  // discarded.
  const cycleDays: number[] = [];
  for (const r of cycle.records ?? []) {
    const d = daysBetweenTs(parseTimestamp(r.CreatedDate), parseTimestamp(r.CloseDate));
    if (Number.isFinite(d) && d >= 0) cycleDays.push(d);
  }

  const window = windowLabel(days);
  const drafts: SignalDraft[] = [
    {
      key: "pipeline_coverage_ratio",
      kind: "ratio",
      value:
        openPipelineValue === null || !wonAmountComplete
          ? null
          : safeRatio(openPipelineValue, wonAmount),
      window,
    },
    {
      key: "win_rate_pct",
      kind: "ratio",
      value: safeRatio(wonCount, wonCount + lostCount),
      window,
    },
    { key: "sales_cycle_days", kind: "aggregate", value: mean(cycleDays), unit: "days", window },
    { key: "stage_distribution", kind: "distribution", value: distributionByLabel(stageCounts) },
  ];

  ctx.log("salesforce.extract.complete", {
    connector: KEY,
    signals: drafts.filter((d) => d.value !== null).length,
  });
  return buildSignalSet({ source: KEY, scope, ctx, drafts });
});
