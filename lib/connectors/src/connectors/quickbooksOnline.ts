import { z } from "zod/v4";
import { httpJson } from "../httpJson";
import {
  buildConnector,
  buildSignalSet,
  computeWindows,
  isoDate,
  safeRatio,
  toNumber,
  trendDelta,
  windowLabel,
  type SignalDraft,
} from "../providerSignals";

// QuickBooks Online (accounting-erp). Runs in the in-client edge agent. It uses
// the QBO Reports API, which returns server-side aggregated totals rather than
// rows, so the bulk of the work is genuine provider aggregation. It reads the
// Profit and Loss summary totals for the current and prior windows and the Aged
// Receivables total, and reduces them to the four declared accounting signals. No
// customer name, invoice number, or line item ever enters a signal: only the
// numeric totals in each report summary are read.

const KEY = "quickbooks-online";

const configSchema = z.object({
  baseUrl: z.string().url().default("https://quickbooks.api.intuit.com"),
  // The QBO company (realm) id. This is a tenant scope identifier, not a secret,
  // and it never appears in a signal.
  realmId: z.string().min(1).max(64),
  minorVersion: z.string().regex(/^\d+$/, "minorVersion must be digits").default("70"),
  windowDays: z.number().int().positive().max(3650).default(90),
});

interface QboColData {
  value?: unknown;
}
interface QboRow {
  group?: string;
  type?: string;
  ColData?: QboColData[];
  Summary?: { ColData?: QboColData[] };
  Header?: { ColData?: QboColData[] };
  Rows?: { Row?: QboRow[] };
}
interface QboReport {
  Rows?: { Row?: QboRow[] };
}

function lastColValue(cols?: QboColData[]): number | null {
  if (!cols || cols.length === 0) return null;
  const v = toNumber(cols[cols.length - 1].value);
  return Number.isFinite(v) ? v : null;
}

// Find a named section total (for example "Income" or "GrossProfit") anywhere in
// the report tree, reading only the numeric total in that section's summary.
function findGroupTotal(rows: QboRow[] | undefined, group: string): number | null {
  if (!rows) return null;
  for (const row of rows) {
    if (row.group === group) {
      const fromSummary = lastColValue(row.Summary?.ColData);
      if (fromSummary !== null) return fromSummary;
      const fromHeader = lastColValue(row.Header?.ColData);
      if (fromHeader !== null) return fromHeader;
    }
    const nested = findGroupTotal(row.Rows?.Row, group);
    if (nested !== null) return nested;
  }
  return null;
}

// Sum the last (total) column of every leaf data row. Used for Aged Receivables,
// where each leaf is a customer line; only the trailing numeric total is read and
// the customer name in the first column is never touched.
//
// `complete` reports whether EVERY contributing customer line carried a finite
// trailing total. A line that exposes columns (a real customer row) but whose
// trailing value is missing or non-numeric leaves the sum partial, so `complete`
// is false and the receivables figure is omitted rather than understated. A
// purely structural row (no columns and no children) is not a customer line and
// does not affect completeness.
interface LeafSum {
  sum: number;
  complete: boolean;
}
interface LeafAcc {
  sum: number;
  seen: boolean;
  complete: boolean;
}
// Walk the report tree once, tracking the running total, whether ANY finite leaf
// total was seen, and whether EVERY customer line carried a finite total. It always
// reports completeness (unlike a null-returning sum) so that a nested section made
// up entirely of malformed customer lines still propagates its incompleteness to
// the parent rather than being silently dropped.
function accumulateLeafTotals(rows: QboRow[] | undefined): LeafAcc {
  const acc: LeafAcc = { sum: 0, seen: false, complete: true };
  if (!rows) return acc;
  for (const row of rows) {
    if (row.Rows?.Row && row.Rows.Row.length > 0) {
      const nested = accumulateLeafTotals(row.Rows.Row);
      acc.sum += nested.sum;
      if (nested.seen) acc.seen = true;
      if (!nested.complete) acc.complete = false;
      continue;
    }
    if (row.ColData && row.ColData.length > 0) {
      const v = toNumber(row.ColData[row.ColData.length - 1].value);
      if (Number.isFinite(v)) {
        acc.sum += v;
        acc.seen = true;
      } else {
        // A customer line whose trailing total is missing or non-numeric: the
        // receivable is unknown, so the aged-receivables sum is partial.
        acc.complete = false;
      }
    }
  }
  return acc;
}
// Returns null when the report carried NO finite leaf total at all (a missing or
// malformed report), so a downstream figure is omitted rather than fabricated as a
// zero. A genuine zero (a real report whose lines net to nothing) still has a finite
// total seen and returns 0 with complete=true.
function sumLeafTotals(rows: QboRow[] | undefined): LeafSum | null {
  const acc = accumulateLeafTotals(rows);
  if (!acc.seen) return null;
  return { sum: acc.sum, complete: acc.complete };
}

export const quickbooksOnlineConnector = buildConnector(KEY, async (scope, ctx) => {
  const parsed = configSchema.safeParse(scope.config ?? {});
  if (!parsed.success) {
    throw new Error(
      "quickbooks-online connector configuration invalid: " +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const cfg = parsed.data;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const token = await ctx.resolveSecret(scope.authRef);
  const headers = { authorization: "Bearer " + token };
  const days = cfg.windowDays;
  const w = computeWindows(ctx.now(), days);
  const plUrl = base + "/v3/company/" + cfg.realmId + "/reports/ProfitAndLoss";
  const arUrl = base + "/v3/company/" + cfg.realmId + "/reports/AgedReceivables";

  const [plCurrent, plPrior, ar] = await Promise.all([
    httpJson<QboReport>(plUrl, {
      headers,
      query: {
        start_date: isoDate(w.start),
        end_date: isoDate(w.end),
        minorversion: cfg.minorVersion,
      },
    }),
    httpJson<QboReport>(plUrl, {
      headers,
      query: {
        start_date: isoDate(w.priorStart),
        end_date: isoDate(w.priorEnd),
        minorversion: cfg.minorVersion,
      },
    }),
    httpJson<QboReport>(arUrl, { headers, query: { minorversion: cfg.minorVersion } }),
  ]);

  const income = findGroupTotal(plCurrent.Rows?.Row, "Income");
  const grossProfit = findGroupTotal(plCurrent.Rows?.Row, "GrossProfit");
  const expenses = findGroupTotal(plCurrent.Rows?.Row, "Expenses");
  const priorIncome = findGroupTotal(plPrior.Rows?.Row, "Income");
  const arTotal = sumLeafTotals(ar.Rows?.Row);

  const grossMargin = grossProfit !== null && income !== null ? safeRatio(grossProfit, income) : null;
  const expenseRatio = expenses !== null && income !== null ? safeRatio(expenses, income) : null;
  // Days sales outstanding: receivables divided by average daily revenue over the
  // window. Omitted when there is no revenue to normalise against, and omitted
  // when the receivables sum is partial (some customer line lacked a finite
  // total), so the figure is never silently understated.
  const arDays =
    income !== null && arTotal !== null && arTotal.complete
      ? safeRatio(arTotal.sum * days, income)
      : null;

  const window = windowLabel(days);
  const drafts: SignalDraft[] = [
    { key: "gross_margin_pct", kind: "ratio", value: grossMargin, window },
    { key: "revenue_trend_delta", kind: "trend_delta", value: trendDelta(income, priorIncome), window },
    { key: "ar_days_outstanding", kind: "aggregate", value: arDays, unit: "days", window },
    { key: "expense_ratio", kind: "ratio", value: expenseRatio, window },
  ];

  ctx.log("quickbooks-online.extract.complete", {
    connector: KEY,
    signals: drafts.filter((d) => d.value !== null).length,
  });
  return buildSignalSet({ source: KEY, scope, ctx, drafts });
});
