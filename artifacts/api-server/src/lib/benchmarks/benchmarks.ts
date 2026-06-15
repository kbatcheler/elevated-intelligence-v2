import { eq } from "drizzle-orm";
import {
  benchmarkCohortsTable,
  benchmarkEventsTable,
  benchmarkStatsTable,
  db,
  tenantsTable,
} from "@workspace/db";
import { CryptoShreddedError, SignalEncryptionError } from "../security/errors";
import { readDecryptedSignalsForMachine, type DecryptedSignalRow } from "../security/signalRead";
import {
  applyNoise,
  computeQuartiles,
  DEFAULT_NOISE_FRACTION,
  segmentKeyFor,
} from "./benchmarkMath";

// Phase X: Benchmarking and the data network effect. A benchmark here is a
// distribution over a cohort of opted-in tenants, never a comparison to named
// companies. The privacy boundary is structural: the recompute reads each
// tenant's de-identified scalar math through the in-boundary MACHINE decrypt
// helper, pools it by segment, publishes a percentile distribution ONLY when at
// least k distinct tenants contributed, and writes cohort and stat rows that
// carry NO tenant reference at all. No raw client data and no tenant identity
// ever crosses into benchmark_cohorts or benchmark_stats. The only tenant id in
// this subsystem lives in the consent log; this recompute path writes none.

export interface BenchmarkLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

const DEFAULT_MIN_COHORT = 5;
const DEFAULT_NOISE_BAND = 20;
const DEFAULT_RECOMPUTE_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Parse a positive integer from an env value, falling back when unset or
// invalid. Mirrors the retention and backup env parsing so configuration behaves
// uniformly across the operational loops.
function intEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// The k-anonymity floor: the minimum number of distinct tenants that must
// contribute a metric before its distribution is ever published. Hard default 5,
// overridable upward or downward by an operator, but the recompute never writes a
// stat below whatever this resolves to.
export function getBenchmarkMinCohort(): number {
  return intEnv(process.env.BENCHMARK_MIN_COHORT, DEFAULT_MIN_COHORT);
}

// The upper edge of the privacy-noise band. A metric whose contributor count is
// in [minCohort, noiseBand) is published with bounded noise (and noised=true); at
// or above it the distribution is reported as computed. Defaults to 20.
export function getBenchmarkNoiseBand(): number {
  return intEnv(process.env.BENCHMARK_NOISE_BAND, DEFAULT_NOISE_BAND);
}

export function getBenchmarkRecomputeIntervalMs(): number {
  return intEnv(process.env.BENCHMARK_RECOMPUTE_INTERVAL_MS, DEFAULT_RECOMPUTE_INTERVAL_MS);
}

export interface BenchmarkRecomputeDeps {
  now: Date;
  minCohort: number;
  noiseBand: number;
  authority: { userId: string | null; role: string };
  log: BenchmarkLogger;
  // Injectable noise source so tests can assert bounds deterministically.
  // Defaults to Math.random; returns a value in [0,1).
  rng?: () => number;
  // The fraction of IQR used as the noise bound. Defaults to DEFAULT_NOISE_FRACTION.
  noiseFraction?: number;
  // Injectable machine read so a test can drive the grouping and gating without
  // standing up the full crypto path. Defaults to the real in-boundary read.
  readSignals?: (tenantId: string) => Promise<DecryptedSignalRow[]>;
}

export interface BenchmarkRecomputeOutcome {
  cohortCount: number;
  statCount: number;
  // Opted-in tenants whose signals were unreadable this run (revoked or missing
  // key) and were skipped. A count only; which tenants is never recorded.
  skippedTenantCount: number;
  // Opted-in, segment-eligible tenants whose signals were read successfully.
  contributingTenantCount: number;
  minCohort: number;
  auditRowId: string;
}

// One metric's pooled samples for a segment, keyed by (layer, signal, window).
// Each opted-in tenant contributes AT MOST ONE value here, so values.length is a
// distinct-tenant count (the unit the k-anonymity floor is measured in), never a
// row count. Held only in memory for the duration of a recompute and never
// persisted with any tenant id attached.
interface MetricSamples {
  layerKey: string;
  signalKey: string;
  window: string | null;
  values: number[];
}

// Run a full benchmark recompute. Pure of any timer and of process.env: the
// caller supplies the clock, the k floor, the noise band, and the authority, so
// it is exercised directly in tests and the scheduled interval is started only
// from the server entrypoint. Steps:
//   1. Load every opted-in, segment-eligible tenant.
//   2. Read each one's de-identified scalar signals through the MACHINE helper,
//      skipping (and counting) any whose key is revoked or missing.
//   3. Pool the scalars by segment and metric, dropping vectors (a distribution
//      is over scalars).
//   4. Supersede the whole benchmark in one transaction: replace all cohorts and
//      stats, writing a cohort row per segment and a stat row only where at least
//      k distinct tenants contributed the metric, with bounded noise in the band.
//   5. Record exactly one identity-free audit row for the run.
export async function runBenchmarkRecompute(
  deps: BenchmarkRecomputeDeps,
): Promise<BenchmarkRecomputeOutcome> {
  const readSignals = deps.readSignals ?? readDecryptedSignalsForMachine;
  const rng = deps.rng ?? Math.random;
  const noiseFraction = deps.noiseFraction ?? DEFAULT_NOISE_FRACTION;

  const optedIn = await db
    .select({
      id: tenantsTable.id,
      sector: tenantsTable.sector,
      revenueBand: tenantsTable.revenueBand,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.benchmarkOptIn, true));

  // Per segment: the normalized labels, the set of contributing tenant ids (for
  // the cohort member count), and the per-metric sample pools. The tenant id set
  // is in-memory bookkeeping only; it never reaches a persisted row.
  interface SegmentAccumulator {
    sector: string;
    revenueBand: string;
    tenantIds: Set<string>;
    metrics: Map<string, MetricSamples>;
  }
  const bySegment = new Map<string, SegmentAccumulator>();
  let skippedTenantCount = 0;
  let contributingTenantCount = 0;

  for (const tenant of optedIn) {
    const seg = segmentKeyFor(tenant.sector, tenant.revenueBand);
    if (!seg) continue; // unset segment: not eligible for any cohort

    let rows: DecryptedSignalRow[];
    try {
      rows = await readSignals(tenant.id);
    } catch (err) {
      // A crypto-shredded (revoked key) or undecryptable tenant is skipped and
      // counted, never failing the whole run. Anything else is a real fault and
      // is rethrown so the run fails loud rather than silently undercounting.
      if (err instanceof CryptoShreddedError || err instanceof SignalEncryptionError) {
        skippedTenantCount += 1;
        continue;
      }
      throw err;
    }

    contributingTenantCount += 1;

    let acc = bySegment.get(seg.segmentKey);
    if (!acc) {
      acc = {
        sector: seg.sector,
        revenueBand: seg.revenueBand,
        tenantIds: new Set<string>(),
        metrics: new Map<string, MetricSamples>(),
      };
      bySegment.set(seg.segmentKey, acc);
    }
    acc.tenantIds.add(tenant.id);

    // Reduce this tenant's rows to ONE latest scalar per (layer, signal, window)
    // before pooling, so a tenant that carries several rows for a metric (for
    // example two connectors emitting it, or a stale duplicate) still counts as a
    // single contributor. A distribution is over scalars; numeric vectors are not
    // benchmarkable here and are dropped. computedAt is an ISO-8601 string, so a
    // lexical comparison is a chronological one.
    const latest = new Map<string, { value: number; computedAt: string; samples: MetricSamples }>();
    for (const row of rows) {
      if (typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
      const metricKey = row.layerKey + "\u0000" + row.signalKey + "\u0000" + (row.window ?? "");
      const prev = latest.get(metricKey);
      if (!prev || row.computedAt > prev.computedAt) {
        latest.set(metricKey, {
          value: row.value,
          computedAt: row.computedAt,
          samples: { layerKey: row.layerKey, signalKey: row.signalKey, window: row.window, values: [] },
        });
      }
    }
    for (const [metricKey, picked] of latest) {
      let metric = acc.metrics.get(metricKey);
      if (!metric) {
        metric = picked.samples;
        acc.metrics.set(metricKey, metric);
      }
      metric.values.push(picked.value);
    }
  }

  // Build the cohort and stat rows to persist. A cohort row is written for every
  // segment with at least one contributing tenant (it carries only an aggregate
  // member count, so a sub-k cohort row still exposes no individual). A stat row
  // is written only where the metric's distinct-contributor count is at least k.
  const cohortRows: (typeof benchmarkCohortsTable.$inferInsert)[] = [];
  const statRows: (typeof benchmarkStatsTable.$inferInsert)[] = [];

  for (const [segmentKey, acc] of bySegment) {
    const memberCount = acc.tenantIds.size;
    cohortRows.push({
      segmentKey,
      sector: acc.sector,
      revenueBand: acc.revenueBand,
      memberCount,
      computedAt: deps.now,
    });

    for (const metric of acc.metrics.values()) {
      const sampleCount = metric.values.length;
      if (sampleCount < deps.minCohort) continue; // hard k-anonymity gate

      const quartiles = computeQuartiles(metric.values);
      const noised = sampleCount < deps.noiseBand;
      const published = noised ? applyNoise(quartiles, rng, noiseFraction) : quartiles;

      statRows.push({
        cohortSegmentKey: segmentKey,
        layerKey: metric.layerKey,
        signalKey: metric.signalKey,
        window: metric.window,
        p25: String(published.p25),
        p50: String(published.p50),
        p75: String(published.p75),
        sampleCount,
        noised,
        computedAt: deps.now,
      });
    }
  }

  // Supersede the whole benchmark atomically: the previous global cohorts and
  // stats are replaced wholesale, and the run's identity-free audit row is
  // written in the same transaction, so a published benchmark and its audit
  // never disagree.
  const auditRowId = await db.transaction(async (tx) => {
    await tx.delete(benchmarkStatsTable);
    await tx.delete(benchmarkCohortsTable);
    if (cohortRows.length > 0) {
      await tx.insert(benchmarkCohortsTable).values(cohortRows);
    }
    if (statRows.length > 0) {
      await tx.insert(benchmarkStatsTable).values(statRows);
    }
    const inserted = await tx
      .insert(benchmarkEventsTable)
      .values({
        action: "recompute",
        cohortCount: cohortRows.length,
        statCount: statRows.length,
        skippedTenantCount,
        minCohort: deps.minCohort,
        authorityUserId: deps.authority.userId,
        authorityRole: deps.authority.role,
        createdAt: deps.now,
      })
      .returning({ id: benchmarkEventsTable.id });
    return inserted[0]!.id;
  });

  deps.log.info(
    {
      cohortCount: cohortRows.length,
      statCount: statRows.length,
      skippedTenantCount,
      contributingTenantCount,
      minCohort: deps.minCohort,
    },
    "benchmark recompute",
  );

  return {
    cohortCount: cohortRows.length,
    statCount: statRows.length,
    skippedTenantCount,
    contributingTenantCount,
    minCohort: deps.minCohort,
    auditRowId,
  };
}
