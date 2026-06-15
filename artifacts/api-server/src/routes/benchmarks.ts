import { count, desc } from "drizzle-orm";
import { Router } from "express";
import { benchmarkCohortsTable, benchmarkEventsTable, benchmarkStatsTable, db } from "@workspace/db";
import {
  getBenchmarkMinCohort,
  getBenchmarkNoiseBand,
  getBenchmarkRecomputeIntervalMs,
  runBenchmarkRecompute,
} from "../lib/benchmarks/benchmarks";
import { logger } from "../lib/logger";
import { requireOwner } from "../middleware/auth";

// The benchmarking control surface (Phase X). Recomputing the cohorts and reading
// the recompute audit are provider-owner concerns, so this is owner-only:
// requireAuth is applied at the /api/benchmarks mount and requireOwner gates each
// route here, the same shape as backups and operations. Nothing here returns a
// contributor list or any tenant identity; the whole subsystem is aggregate by
// construction.
export const benchmarksRouter: Router = Router();

// Trigger a full recompute now. Honest about the outcome: the response carries the
// run-level counts (cohorts, stats, skipped and contributing tenants) but never
// names a tenant. The k floor and noise band are read from the operator config at
// the moment of the run.
benchmarksRouter.post("/recompute", requireOwner, async (req, res, next) => {
  try {
    const user = req.user!;
    const outcome = await runBenchmarkRecompute({
      now: new Date(),
      minCohort: getBenchmarkMinCohort(),
      noiseBand: getBenchmarkNoiseBand(),
      authority: { userId: user.id, role: user.role },
      log: logger,
    });
    logger.info(
      {
        cohortCount: outcome.cohortCount,
        statCount: outcome.statCount,
        skippedTenantCount: outcome.skippedTenantCount,
        contributingTenantCount: outcome.contributingTenantCount,
        authorityUserId: user.id,
      },
      "manual benchmark recompute",
    );
    res.json(outcome);
  } catch (err) {
    next(err);
  }
});

// Read the recompute audit history (owner only). Identity-free run rows.
benchmarksRouter.get("/events", requireOwner, async (_req, res, next) => {
  try {
    const events = await db
      .select()
      .from(benchmarkEventsTable)
      .orderBy(desc(benchmarkEventsTable.createdAt));
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// Benchmark subsystem status: the operator config (k floor, noise band, cadence),
// the current aggregate cohort and stat counts, and the most recent recompute
// event. Aggregate counts only, never a cohort roster or a tenant id.
benchmarksRouter.get("/status", requireOwner, async (_req, res, next) => {
  try {
    const [cohorts] = await db.select({ value: count() }).from(benchmarkCohortsTable);
    const [stats] = await db.select({ value: count() }).from(benchmarkStatsTable);
    const last = await db
      .select()
      .from(benchmarkEventsTable)
      .orderBy(desc(benchmarkEventsTable.createdAt))
      .limit(1);
    res.json({
      minCohort: getBenchmarkMinCohort(),
      noiseBand: getBenchmarkNoiseBand(),
      recomputeIntervalMs: getBenchmarkRecomputeIntervalMs(),
      cohortCount: cohorts?.value ?? 0,
      statCount: stats?.value ?? 0,
      lastRecompute: last[0] ?? null,
    });
  } catch (err) {
    next(err);
  }
});
