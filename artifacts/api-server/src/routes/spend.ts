import { desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { Router } from "express";
import { db, modelUsageTable, tenantsTable } from "@workspace/db";
import { budgetCaps, monthStart, spendSince } from "../lib/pipeline/budget";

export const spendRouter: Router = Router();

// Every figure on this surface is summed from the model_usage ledger, where each
// row is one real model call priced from real token counts. Nothing here is
// estimated or projected. The numeric ledger column comes back from pg as a
// string, so it is parsed to a number at this single edge; the integer token
// columns and the bigint count(*) likewise.
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const SUM_COST = sql<string>`coalesce(sum(${modelUsageTable.costUsd}), 0)`;
const CALLS = sql<string>`count(*)`;

// Owner-only spend summary. Mounted behind requireAuth + requireOwner in app.ts,
// so this handler does not re-check the role. One request returns every cut the
// console needs: lifetime totals, this month's spend against the caps, and the
// spend broken down by tenant, seat, stage, recent run, and day.
spendRouter.get("/summary", async (_req, res, next) => {
  try {
    const since = monthStart();
    const caps = budgetCaps();

    const totalsRows = await db
      .select({
        costUsd: SUM_COST,
        calls: CALLS,
        inputTokens: sql<string>`coalesce(sum(${modelUsageTable.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${modelUsageTable.outputTokens}), 0)`,
        cacheReadTokens: sql<string>`coalesce(sum(${modelUsageTable.cacheReadTokens}), 0)`,
        cacheCreationTokens: sql<string>`coalesce(sum(${modelUsageTable.cacheCreationTokens}), 0)`,
        webSearchCalls: sql<string>`coalesce(sum(${modelUsageTable.webSearchCalls}), 0)`,
      })
      .from(modelUsageTable);
    const t = totalsRows[0];

    const globalMonthSpendUsd = await spendSince(since);

    const byTenant = await db
      .select({
        tenantId: modelUsageTable.tenantId,
        name: tenantsTable.name,
        costUsd: SUM_COST,
        calls: CALLS,
      })
      .from(modelUsageTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, modelUsageTable.tenantId))
      .groupBy(modelUsageTable.tenantId, tenantsTable.name)
      .orderBy(desc(sql`sum(${modelUsageTable.costUsd})`));

    const bySeat = await db
      .select({ seat: modelUsageTable.seat, costUsd: SUM_COST, calls: CALLS })
      .from(modelUsageTable)
      .groupBy(modelUsageTable.seat)
      .orderBy(desc(sql`sum(${modelUsageTable.costUsd})`));

    const byStage = await db
      .select({ stage: modelUsageTable.stage, costUsd: SUM_COST, calls: CALLS })
      .from(modelUsageTable)
      .groupBy(modelUsageTable.stage)
      .orderBy(desc(sql`sum(${modelUsageTable.costUsd})`));

    const byRun = await db
      .select({
        runId: modelUsageTable.runId,
        tenantId: modelUsageTable.tenantId,
        tenantName: tenantsTable.name,
        layerKey: modelUsageTable.layerKey,
        costUsd: SUM_COST,
        calls: CALLS,
        at: sql<string>`max(${modelUsageTable.createdAt})`,
      })
      .from(modelUsageTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, modelUsageTable.tenantId))
      .where(isNotNull(modelUsageTable.runId))
      .groupBy(
        modelUsageTable.runId,
        modelUsageTable.tenantId,
        tenantsTable.name,
        modelUsageTable.layerKey,
      )
      .orderBy(desc(sql`max(${modelUsageTable.createdAt})`))
      .limit(50);

    // Daily series over the trailing 30 days for the spend-over-time view. A day
    // with no spend simply has no row; the console renders the gap honestly
    // rather than inventing a zero point.
    const dailySince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const daily = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${modelUsageTable.createdAt}), 'YYYY-MM-DD')`,
        costUsd: SUM_COST,
      })
      .from(modelUsageTable)
      .where(gte(modelUsageTable.createdAt, dailySince))
      .groupBy(sql`date_trunc('day', ${modelUsageTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${modelUsageTable.createdAt})`);

    res.json({
      spend: {
        total: {
          costUsd: num(t?.costUsd),
          calls: num(t?.calls),
          inputTokens: num(t?.inputTokens),
          outputTokens: num(t?.outputTokens),
          cacheReadTokens: num(t?.cacheReadTokens),
          cacheCreationTokens: num(t?.cacheCreationTokens),
          webSearchCalls: num(t?.webSearchCalls),
        },
        caps: {
          globalMonthlyCapUsd: caps.globalMonthlyCapUsd,
          tenantMonthlyCapUsd: caps.tenantMonthlyCapUsd,
          alertThreshold: caps.alertThreshold,
          monthStart: since.toISOString(),
          globalMonthSpendUsd,
          globalOverThreshold:
            caps.globalMonthlyCapUsd > 0 &&
            globalMonthSpendUsd >= caps.globalMonthlyCapUsd * caps.alertThreshold,
          globalOverCap:
            caps.globalMonthlyCapUsd > 0 && globalMonthSpendUsd >= caps.globalMonthlyCapUsd,
        },
        byTenant: byTenant.map((r) => ({
          tenantId: r.tenantId,
          name: r.name ?? null,
          costUsd: num(r.costUsd),
          calls: num(r.calls),
        })),
        bySeat: bySeat.map((r) => ({ seat: r.seat, costUsd: num(r.costUsd), calls: num(r.calls) })),
        byStage: byStage.map((r) => ({
          stage: r.stage,
          costUsd: num(r.costUsd),
          calls: num(r.calls),
        })),
        byRun: byRun.map((r) => ({
          runId: r.runId,
          tenantId: r.tenantId,
          tenantName: r.tenantName ?? null,
          layerKey: r.layerKey,
          costUsd: num(r.costUsd),
          calls: num(r.calls),
          at: r.at,
        })),
        daily: daily.map((r) => ({ day: r.day, costUsd: num(r.costUsd) })),
      },
    });
  } catch (err) {
    next(err);
  }
});
