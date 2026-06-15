// Sellability Pack (Phase AB): anonymized, segment-level case studies built from
// the real Phase W outcome loop. A case study is a DISTRIBUTION over a cohort of
// opted-in tenants in one segment, never a named company and never a single
// company's figure. It reuses the exact Phase X privacy machinery: the same
// k-anonymity floor (getBenchmarkMinCohort) gates whether a segment is published
// at all, and the same bounded noise (applyNoise within the noiseBand) blurs a
// small cohort's quartiles. No tenant id, name, url, or date ever appears in the
// output; only an aggregate over at least k contributors does.

import { eq, inArray } from "drizzle-orm";
import {
  committedActionsTable,
  db,
  outcomeMeasurementsTable,
  tenantsTable,
} from "@workspace/db";
import {
  computeOutcomeSummary,
  toNum,
  type ActionValue,
  type MeasurementValue,
} from "../outcomes/outcomeMath";
import {
  getBenchmarkMinCohort,
  getBenchmarkNoiseBand,
} from "../benchmarks/benchmarks";
import {
  applyNoise,
  computeQuartiles,
  DEFAULT_NOISE_FRACTION,
  segmentKeyFor,
  type Quartiles,
} from "../benchmarks/benchmarkMath";

// One tenant's de-identified contribution to its segment. It carries the segment
// labels and the tenant's own realized and identified value plus its resolved
// calibration counts, never the tenant id (the loader drops it before building).
export interface CaseStudyContribution {
  segmentKey: string;
  sector: string;
  revenueBand: string;
  realizedUsd: number;
  identifiedUsd: number;
  calibrationHits: number;
  calibrationMisses: number;
}

export interface CaseStudy {
  segmentKey: string;
  sector: string;
  revenueBand: string;
  // Distinct opted-in contributors with a track record. Always >= the k floor.
  contributorCount: number;
  // True when the cohort fell in [minCohort, noiseBand) and the published
  // quartiles were blurred. An honest flag so the surface can label it.
  noised: boolean;
  realizedUsd: Quartiles;
  identifiedUsd: Quartiles;
  // Cohort-level realized accuracy: hits over resolved across the whole segment.
  // An aggregate, never one company's record. score is null when nothing resolved.
  calibration: { hits: number; misses: number; resolved: number; score: number | null };
}

export interface BuildCaseStudiesOptions {
  minCohort: number;
  noiseBand: number;
  rng?: () => number;
  noiseFraction?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Pure: group contributions by segment, publish a case study ONLY for a segment
// with at least minCohort distinct contributors, and blur the quartiles when the
// cohort is below the noise band. Sorted by segmentKey for a stable output.
export function buildCaseStudies(
  contributions: readonly CaseStudyContribution[],
  options: BuildCaseStudiesOptions,
): CaseStudy[] {
  const rng = options.rng ?? Math.random;
  const noiseFraction = options.noiseFraction ?? DEFAULT_NOISE_FRACTION;

  interface SegmentAccumulator {
    sector: string;
    revenueBand: string;
    realized: number[];
    identified: number[];
    hits: number;
    misses: number;
  }
  const bySegment = new Map<string, SegmentAccumulator>();

  for (const c of contributions) {
    let acc = bySegment.get(c.segmentKey);
    if (!acc) {
      acc = {
        sector: c.sector,
        revenueBand: c.revenueBand,
        realized: [],
        identified: [],
        hits: 0,
        misses: 0,
      };
      bySegment.set(c.segmentKey, acc);
    }
    acc.realized.push(c.realizedUsd);
    acc.identified.push(c.identifiedUsd);
    acc.hits += c.calibrationHits;
    acc.misses += c.calibrationMisses;
  }

  const studies: CaseStudy[] = [];
  for (const [segmentKey, acc] of bySegment) {
    const contributorCount = acc.realized.length;
    if (contributorCount < options.minCohort) continue; // hard k-anonymity gate

    const noised = contributorCount < options.noiseBand;
    const realizedRaw = computeQuartiles(acc.realized);
    const identifiedRaw = computeQuartiles(acc.identified);
    const realizedUsd = noised ? applyNoise(realizedRaw, rng, noiseFraction) : realizedRaw;
    const identifiedUsd = noised ? applyNoise(identifiedRaw, rng, noiseFraction) : identifiedRaw;
    const resolved = acc.hits + acc.misses;

    studies.push({
      segmentKey,
      sector: acc.sector,
      revenueBand: acc.revenueBand,
      contributorCount,
      noised,
      realizedUsd: {
        p25: round2(realizedUsd.p25),
        p50: round2(realizedUsd.p50),
        p75: round2(realizedUsd.p75),
      },
      identifiedUsd: {
        p25: round2(identifiedUsd.p25),
        p50: round2(identifiedUsd.p50),
        p75: round2(identifiedUsd.p75),
      },
      calibration: {
        hits: acc.hits,
        misses: acc.misses,
        resolved,
        score: resolved > 0 ? round2(acc.hits / resolved) : null,
      },
    });
  }

  studies.sort((a, b) => (a.segmentKey < b.segmentKey ? -1 : a.segmentKey > b.segmentKey ? 1 : 0));
  return studies;
}

// Load every opted-in tenant's outcome contribution, keeping only tenants with a
// real track record (at least one resolved outcome), then build the published
// case studies. The per-tenant outcome math is the SAME computeOutcomeSummary the
// /outcomes endpoint uses, so a case study can never disagree with the counter.
export async function loadCaseStudyContributions(): Promise<CaseStudyContribution[]> {
  const optedIn = await db
    .select({
      id: tenantsTable.id,
      sector: tenantsTable.sector,
      revenueBand: tenantsTable.revenueBand,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.benchmarkOptIn, true));

  const eligible = optedIn
    .map((t) => ({ ...t, seg: segmentKeyFor(t.sector, t.revenueBand) }))
    .filter((t): t is typeof t & { seg: NonNullable<typeof t.seg> } => t.seg != null);

  if (eligible.length === 0) return [];
  const tenantIds = eligible.map((t) => t.id);

  // Two batched reads, grouped in memory, so the contribution scan is two queries
  // regardless of cohort size rather than two per tenant.
  const actionRows = await db
    .select({
      tenantId: committedActionsTable.tenantId,
      id: committedActionsTable.id,
      predictedValueUsd: committedActionsTable.predictedValueUsd,
      status: committedActionsTable.status,
    })
    .from(committedActionsTable)
    .where(inArray(committedActionsTable.tenantId, tenantIds));

  const measurementRows = await db
    .select({
      tenantId: committedActionsTable.tenantId,
      actionId: outcomeMeasurementsTable.actionId,
      realizedValueUsd: outcomeMeasurementsTable.realizedValueUsd,
      status: outcomeMeasurementsTable.status,
      measuredAt: outcomeMeasurementsTable.measuredAt,
      createdAt: outcomeMeasurementsTable.createdAt,
    })
    .from(outcomeMeasurementsTable)
    .innerJoin(
      committedActionsTable,
      eq(outcomeMeasurementsTable.actionId, committedActionsTable.id),
    )
    .where(inArray(committedActionsTable.tenantId, tenantIds));

  const actionsByTenant = new Map<string, ActionValue[]>();
  for (const a of actionRows) {
    const list = actionsByTenant.get(a.tenantId) ?? [];
    list.push({ id: a.id, predictedValueUsd: toNum(a.predictedValueUsd), status: a.status });
    actionsByTenant.set(a.tenantId, list);
  }

  const measurementsByTenant = new Map<string, MeasurementValue[]>();
  for (const m of measurementRows) {
    const list = measurementsByTenant.get(m.tenantId) ?? [];
    list.push({
      actionId: m.actionId,
      realizedValueUsd: toNum(m.realizedValueUsd),
      status: m.status,
      measuredAt: m.measuredAt.getTime(),
      createdAt: m.createdAt.getTime(),
    });
    measurementsByTenant.set(m.tenantId, list);
  }

  const contributions: CaseStudyContribution[] = [];
  for (const t of eligible) {
    const summary = computeOutcomeSummary(
      actionsByTenant.get(t.id) ?? [],
      measurementsByTenant.get(t.id) ?? [],
    );
    // Only a tenant with a resolved outcome (a real track record) is a case
    // study contributor; identified-but-unmeasured value is not yet evidence.
    if (summary.calibration.resolved < 1) continue;
    contributions.push({
      segmentKey: t.seg.segmentKey,
      sector: t.seg.sector,
      revenueBand: t.seg.revenueBand,
      realizedUsd: summary.valueRealizedUsd,
      identifiedUsd: summary.valueIdentifiedUsd,
      calibrationHits: summary.calibration.hits,
      calibrationMisses: summary.calibration.misses,
    });
  }
  return contributions;
}

// All published case studies, k-anonymity and noise applied. Used by the authed
// provider/owner case-study list and the board pack.
export async function loadCaseStudies(): Promise<CaseStudy[]> {
  const contributions = await loadCaseStudyContributions();
  return buildCaseStudies(contributions, {
    minCohort: getBenchmarkMinCohort(),
    noiseBand: getBenchmarkNoiseBand(),
  });
}

// The single published case study for one tenant's own segment, or null when the
// tenant has no eligible segment or its segment has fewer than k contributors.
// This is the social-proof block on the public shareable diagnosis: a prospect
// sees the aggregate outcome of companies like theirs, never an identity.
export async function loadCaseStudyForTenant(tenantId: string): Promise<CaseStudy | null> {
  const rows = await db
    .select({ sector: tenantsTable.sector, revenueBand: tenantsTable.revenueBand })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  const tenant = rows[0];
  if (!tenant) return null;
  const seg = segmentKeyFor(tenant.sector, tenant.revenueBand);
  if (!seg) return null;

  const studies = await loadCaseStudies();
  return studies.find((s) => s.segmentKey === seg.segmentKey) ?? null;
}
