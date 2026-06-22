import { z } from "zod/v4";
import { httpJson } from "../httpJson";
import {
  buildConnector,
  buildSignalSet,
  computeWindows,
  distributionByLabel,
  finiteOrNull,
  isoDate,
  safeRatio,
  toNumber,
  trendDelta,
  windowLabel,
  type SignalDraft,
} from "../providerSignals";

// Google Analytics 4 (marketing-web-analytics). Runs in the in-client edge agent.
// It calls the GA4 Data API runReport endpoint, which returns server-side
// aggregated metric totals plus a per-channel breakdown. It reduces those to the
// four declared marketing signals. The channel labels order the channel-mix
// distribution and are then discarded; only the session counts and metric totals
// (numbers) leave the boundary.

const KEY = "google-analytics-4";

const configSchema = z.object({
  baseUrl: z.string().url().default("https://analyticsdata.googleapis.com"),
  apiVersion: z.string().regex(/^v\d+[a-z]*$/, "apiVersion must look like v1beta").default("v1beta"),
  // The GA4 numeric property id. A scope identifier, never a secret.
  propertyId: z.string().regex(/^\d+$/, "propertyId must be the numeric GA4 property id"),
  windowDays: z.number().int().positive().max(3650).default(90),
});

interface Ga4MetricValue {
  value?: unknown;
}
interface Ga4Row {
  dimensionValues?: Array<{ value?: unknown }>;
  metricValues?: Ga4MetricValue[];
}
interface Ga4Response {
  rows?: Ga4Row[];
  totals?: Array<{ metricValues?: Ga4MetricValue[] }>;
}

export const googleAnalytics4Connector = buildConnector(KEY, async (scope, ctx) => {
  const parsed = configSchema.safeParse(scope.config ?? {});
  if (!parsed.success) {
    throw new Error(
      "google-analytics-4 connector configuration invalid: " +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const cfg = parsed.data;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const token = await ctx.resolveSecret(scope.authRef);
  const headers = { authorization: "Bearer " + token };
  const days = cfg.windowDays;
  const w = computeWindows(ctx.now(), days);
  const runUrl = base + "/" + cfg.apiVersion + "/properties/" + cfg.propertyId + ":runReport";

  const currentBody = {
    dateRanges: [{ startDate: isoDate(w.start), endDate: isoDate(w.end) }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [
      { name: "sessions" },
      { name: "conversions" },
      { name: "engagementRate" },
      { name: "advertiserAdCost" },
    ],
  };
  const priorBody = {
    dateRanges: [{ startDate: isoDate(w.priorStart), endDate: isoDate(w.priorEnd) }],
    metrics: [{ name: "advertiserAdCost" }, { name: "conversions" }],
  };

  const [current, prior] = await Promise.all([
    httpJson<Ga4Response>(runUrl, { method: "POST", headers, body: currentBody }),
    httpJson<Ga4Response>(runUrl, { method: "POST", headers, body: priorBody }),
  ]);

  const channelCounts = new Map<string, number>();
  for (const row of current.rows ?? []) {
    const channel =
      typeof row.dimensionValues?.[0]?.value === "string" ? row.dimensionValues[0].value : "";
    const sessions = toNumber(row.metricValues?.[0]?.value);
    if (channel && Number.isFinite(sessions)) {
      channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + sessions);
    }
  }

  const totals = current.totals?.[0]?.metricValues ?? [];
  const totalSessions = toNumber(totals[0]?.value);
  const totalConversions = toNumber(totals[1]?.value);
  const engagementRate = toNumber(totals[2]?.value);
  const adCost = toNumber(totals[3]?.value);

  const priorTotals = prior.totals?.[0]?.metricValues ?? [];
  const priorAdCost = toNumber(priorTotals[0]?.value);
  const priorConversions = toNumber(priorTotals[1]?.value);

  const currentCac = safeRatio(adCost, totalConversions);
  const priorCac = safeRatio(priorAdCost, priorConversions);

  const window = windowLabel(days);
  const drafts: SignalDraft[] = [
    {
      key: "conversion_rate_pct",
      kind: "ratio",
      value: safeRatio(totalConversions, totalSessions),
      window,
    },
    { key: "cac_trend_delta", kind: "trend_delta", value: trendDelta(currentCac, priorCac), window },
    {
      key: "channel_mix_distribution",
      kind: "distribution",
      value: distributionByLabel(channelCounts),
    },
    { key: "engagement_index", kind: "score", value: finiteOrNull(engagementRate), window },
  ];

  ctx.log("google-analytics-4.extract.complete", {
    connector: KEY,
    signals: drafts.filter((d) => d.value !== null).length,
  });
  return buildSignalSet({ source: KEY, scope, ctx, drafts });
});
