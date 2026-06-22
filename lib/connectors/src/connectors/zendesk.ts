import { z } from "zod/v4";
import { httpJson } from "../httpJson";
import {
  buildConnector,
  buildSignalSet,
  computeWindows,
  isoDate,
  mean,
  safeRatio,
  toNumber,
  trendDelta,
  windowLabel,
  type SignalDraft,
} from "../providerSignals";

// Zendesk (support-customer). Runs in the in-client edge agent. Counts come from
// the search/count endpoint, which returns server-side aggregate counts only (no
// records), so created, solved, and satisfaction figures are exact and carry
// nothing reversible. First response time is a bounded sample mean over recent
// ticket metrics, reading only the numeric reply-time field. No ticket subject,
// requester, or assignee ever enters a signal.

const KEY = "zendesk";

const configSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    // The Zendesk subdomain (the "acme" in acme.zendesk.com).
    subdomain: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "subdomain must be a Zendesk subdomain")
      .optional(),
    windowDays: z.number().int().positive().max(3650).default(90),
    // The bounded cap on the first-response-time sample.
    sampleLimit: z.number().int().positive().max(1000).default(200),
  })
  .refine((c) => Boolean(c.baseUrl ?? c.subdomain), {
    message: "zendesk connector requires baseUrl or subdomain in scope.config",
  });

interface CountResponse {
  count?: unknown;
}
interface TicketMetricsResponse {
  ticket_metrics?: Array<{ reply_time_in_minutes?: { calendar?: unknown } }>;
}

export const zendeskConnector = buildConnector(KEY, async (scope, ctx) => {
  const parsed = configSchema.safeParse(scope.config ?? {});
  if (!parsed.success) {
    throw new Error(
      "zendesk connector configuration invalid: " +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const cfg = parsed.data;
  const base = (cfg.baseUrl ?? "https://" + cfg.subdomain + ".zendesk.com").replace(/\/+$/, "");
  const token = await ctx.resolveSecret(scope.authRef);
  const headers = { authorization: "Bearer " + token };
  const days = cfg.windowDays;
  const w = computeWindows(ctx.now(), days);
  const currentStart = isoDate(w.start);
  const priorStart = isoDate(w.priorStart);
  const priorEnd = isoDate(w.priorEnd);

  async function count(query: string): Promise<number> {
    const res = await httpJson<CountResponse>(base + "/api/v2/search/count.json", {
      headers,
      query: { query },
    });
    return toNumber(res.count);
  }

  const [createdCurrent, createdPrior, solvedCurrent, good, bad, metrics] = await Promise.all([
    count("type:ticket created>=" + currentStart),
    count("type:ticket created>=" + priorStart + " created<" + priorEnd),
    count("type:ticket created>=" + currentStart + " status:solved"),
    count("type:ticket created>=" + currentStart + " satisfaction:good"),
    count("type:ticket created>=" + currentStart + " satisfaction:bad"),
    httpJson<TicketMetricsResponse>(base + "/api/v2/ticket_metrics.json", {
      headers,
      query: { "page[size]": cfg.sampleLimit },
    }),
  ]);

  const responseHours: number[] = [];
  for (const m of metrics.ticket_metrics ?? []) {
    const minutes = toNumber(m.reply_time_in_minutes?.calendar);
    if (Number.isFinite(minutes) && minutes >= 0) responseHours.push(minutes / 60);
  }

  const window = windowLabel(days);
  const drafts: SignalDraft[] = [
    { key: "csat_index", kind: "score", value: safeRatio(good, good + bad), window },
    {
      key: "first_response_hours",
      kind: "aggregate",
      value: mean(responseHours),
      unit: "hours",
      window,
    },
    {
      key: "ticket_volume_trend_delta",
      kind: "trend_delta",
      value: trendDelta(createdCurrent, createdPrior),
      window,
    },
    {
      key: "resolution_rate_pct",
      kind: "ratio",
      value: safeRatio(solvedCurrent, createdCurrent),
      window,
    },
  ];

  ctx.log("zendesk.extract.complete", {
    connector: KEY,
    signals: drafts.filter((d) => d.value !== null).length,
  });
  return buildSignalSet({ source: KEY, scope, ctx, drafts });
});
