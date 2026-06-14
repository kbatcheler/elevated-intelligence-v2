// Phase N budget governor. Reads the real model_usage ledger and decides whether
// a new seed may proceed under the configured monthly caps. Every figure is the
// summed real cost from the ledger; nothing here is estimated. The caps and the
// alert threshold are env-backed so an operator never edits code to change a
// budget.

import type { Logger } from "@workspace/cortex";
import { db, modelUsageTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

export interface BudgetCaps {
  globalMonthlyCapUsd: number;
  tenantMonthlyCapUsd: number;
  // Fraction of a cap (0..1) at which a warning is raised while spend is still
  // under the cap.
  alertThreshold: number;
}

function numEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function clampFraction(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0.8;
  return n > 1 ? 1 : n;
}

// The Phase N cost-cap decision (verify and tune per deployment): a 1000 USD
// global monthly ceiling, a 50 USD per-tenant monthly ceiling, and an alert at
// 80% of either ceiling. All three are overridable from the environment.
export function budgetCaps(env: NodeJS.ProcessEnv = process.env): BudgetCaps {
  return {
    globalMonthlyCapUsd: numEnv(env.SPEND_GLOBAL_MONTHLY_CAP_USD, 1000),
    tenantMonthlyCapUsd: numEnv(env.SPEND_TENANT_MONTHLY_CAP_USD, 50),
    alertThreshold: clampFraction(numEnv(env.SPEND_ALERT_THRESHOLD, 0.8)),
  };
}

// First instant of the current calendar month in UTC. The monthly window is
// [monthStart, now); a new month resets the running total honestly.
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Summed real cost since an instant, optionally scoped to one tenant. SUM over an
// empty window coalesces to zero, never null.
export async function spendSince(since: Date, tenantId?: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${modelUsageTable.costUsd}), 0)` })
    .from(modelUsageTable)
    .where(
      tenantId
        ? and(gte(modelUsageTable.createdAt, since), eq(modelUsageTable.tenantId, tenantId))
        : gte(modelUsageTable.createdAt, since),
    );
  return Number(rows[0]?.total ?? 0);
}

export type BudgetScope = "global" | "tenant";

// Thrown when a ceiling is already reached. Carries the scope and the figures so
// a route can render a clear, honest message instead of a generic failure.
export class BudgetExceededError extends Error {
  constructor(
    public scope: BudgetScope,
    public spentUsd: number,
    public capUsd: number,
    message: string,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface AssertBudgetOptions {
  tenantId?: string | null;
  // Owner-only override: lets a deliberately prioritised seed proceed past the
  // GLOBAL ceiling only. A per-tenant ceiling is always enforced.
  priorityOverride?: boolean;
  log?: Logger;
}

// Gate a new seed against the monthly caps before any model spend is committed.
// A non-priority seed is refused once the global ceiling is reached; the owner
// may override that single refusal. A per-tenant ceiling is always enforced.
// Crossing the alert threshold without yet reaching a ceiling logs a warning; the
// Phase P notifier will consume the same signal from the spend API.
export async function assertSeedWithinBudget(opts: AssertBudgetOptions = {}): Promise<void> {
  const caps = budgetCaps();
  const since = monthStart();

  if (caps.globalMonthlyCapUsd > 0) {
    const globalSpend = await spendSince(since);
    if (globalSpend >= caps.globalMonthlyCapUsd && !opts.priorityOverride) {
      throw new BudgetExceededError(
        "global",
        globalSpend,
        caps.globalMonthlyCapUsd,
        `global monthly model budget reached (${globalSpend.toFixed(2)} of ${caps.globalMonthlyCapUsd.toFixed(2)} USD); new seeds are paused until next month, or run an express seed to spend less`,
      );
    }
    if (
      globalSpend >= caps.globalMonthlyCapUsd * caps.alertThreshold &&
      globalSpend < caps.globalMonthlyCapUsd
    ) {
      opts.log?.warn(
        { scope: "global", spentUsd: globalSpend, capUsd: caps.globalMonthlyCapUsd },
        "model budget alert threshold crossed",
      );
    }
  }

  const tenantId = opts.tenantId;
  if (tenantId && caps.tenantMonthlyCapUsd > 0) {
    const tenantSpend = await spendSince(since, tenantId);
    if (tenantSpend >= caps.tenantMonthlyCapUsd) {
      throw new BudgetExceededError(
        "tenant",
        tenantSpend,
        caps.tenantMonthlyCapUsd,
        `tenant monthly model budget reached (${tenantSpend.toFixed(2)} of ${caps.tenantMonthlyCapUsd.toFixed(2)} USD); this tenant is paused until next month`,
      );
    }
    if (
      tenantSpend >= caps.tenantMonthlyCapUsd * caps.alertThreshold &&
      tenantSpend < caps.tenantMonthlyCapUsd
    ) {
      opts.log?.warn(
        { scope: "tenant", tenantId, spentUsd: tenantSpend, capUsd: caps.tenantMonthlyCapUsd },
        "model budget alert threshold crossed",
      );
    }
  }
}
