import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { Router } from "express";
import { db, forecastsTable, tenantsTable } from "@workspace/db";
import { z } from "zod";
import { isOwner } from "../lib/auth/access";
import { resolveAccessibleTenantIds } from "../lib/auth/tenantScope";
import {
  aggregateBrier,
  aggregateBy,
  calibrationCurve,
  labelSample,
  NAIVE_BASELINE,
  type ResolvedForecastPoint,
  type SampleLabel,
} from "../lib/calibration/brierMath";
import { calibrationConfig } from "../lib/calibration/config";
import { resolveForecastByOwner } from "../lib/calibration/forecastResolution";

export const calibrationRouter: Router = Router();

// The most recent resolved forecasts surfaced in the ledger. The ledger always
// includes misses (outcome 0); it is a track record, not a highlight reel.
const LEDGER_LIMIT = 200;

// pg returns numeric columns as strings. Parse at this single edge so every
// figure downstream is a real number computed from persisted state.
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface SegmentView {
  key: string;
  meanBrier: number | null;
  n: number;
  label: SampleLabel;
}

interface LedgerRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  layerKey: string;
  kind: string;
  subjectSeat: string;
  statement: string;
  sourcePath: string | null;
  probability: number;
  outcome: number;
  brierScore: number | null;
  resolutionBasis: string | null;
  madeAt: string | null;
  resolveBy: string | null;
  resolvedAt: string | null;
}

interface CalibrationSummary {
  scope: { kind: "system" | "tenant"; tenantId: string | null; tenantName: string | null };
  threshold: number;
  baseline: number;
  headline: {
    meanBrier: number | null;
    n: number;
    label: SampleLabel;
    beatsBaseline: boolean | null;
  };
  curve: ReturnType<typeof calibrationCurve>;
  byLayer: SegmentView[];
  byKind: SegmentView[];
  bySeat: SegmentView[];
  resolvedCount: number;
  openCount: number;
  ledger: LedgerRow[];
}

function withLabel(
  segments: { key: string; meanBrier: number | null; n: number }[],
  threshold: number,
): SegmentView[] {
  return segments.map((s) => ({ ...s, label: labelSample(s.n, threshold) }));
}

// Build the calibration summary for a scope: a single tenant, or the whole
// system when tenantId is null. Every figure is computed from resolved
// forecasts; nothing is shown for an empty set beyond an honest zero count.
async function buildSummary(tenantId: string | null): Promise<CalibrationSummary> {
  const { minResolvedPerSegment: threshold } = calibrationConfig();

  const resolvedWhere = tenantId
    ? and(eq(forecastsTable.tenantId, tenantId), isNotNull(forecastsTable.resolvedAt))
    : isNotNull(forecastsTable.resolvedAt);

  const resolvedRows = await db
    .select({
      id: forecastsTable.id,
      tenantId: forecastsTable.tenantId,
      tenantName: tenantsTable.name,
      layerKey: forecastsTable.layerKey,
      kind: forecastsTable.kind,
      subjectSeat: forecastsTable.subjectSeat,
      statement: forecastsTable.statement,
      sourcePath: forecastsTable.sourcePath,
      probability: forecastsTable.probability,
      outcome: forecastsTable.outcome,
      brierScore: forecastsTable.brierScore,
      resolutionBasis: forecastsTable.resolutionBasis,
      madeAt: forecastsTable.madeAt,
      resolveBy: forecastsTable.resolveBy,
      resolvedAt: forecastsTable.resolvedAt,
    })
    .from(forecastsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, forecastsTable.tenantId))
    .where(resolvedWhere)
    .orderBy(desc(forecastsTable.resolvedAt));

  const points: ResolvedForecastPoint[] = resolvedRows
    .filter((r) => r.outcome === 0 || r.outcome === 1)
    .map((r) => ({
      probability: num(r.probability),
      outcome: r.outcome as 0 | 1,
      layerKey: r.layerKey,
      kind: r.kind,
      subjectSeat: r.subjectSeat,
    }));

  const headlineAgg = aggregateBrier(points);
  const headline = {
    meanBrier: headlineAgg.meanBrier,
    n: headlineAgg.n,
    label: labelSample(headlineAgg.n, threshold),
    beatsBaseline: headlineAgg.meanBrier === null ? null : headlineAgg.meanBrier < NAIVE_BASELINE,
  };

  const ledger: LedgerRow[] = resolvedRows.slice(0, LEDGER_LIMIT).map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenantName ?? null,
    layerKey: r.layerKey,
    kind: r.kind,
    subjectSeat: r.subjectSeat,
    statement: r.statement,
    sourcePath: r.sourcePath ?? null,
    probability: num(r.probability),
    outcome: r.outcome ?? 0,
    brierScore: r.brierScore === null ? null : num(r.brierScore),
    resolutionBasis: r.resolutionBasis ?? null,
    madeAt: r.madeAt ? r.madeAt.toISOString() : null,
    resolveBy: r.resolveBy ? r.resolveBy.toISOString() : null,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  }));

  const openWhere = tenantId
    ? and(eq(forecastsTable.tenantId, tenantId), isNull(forecastsTable.resolvedAt))
    : isNull(forecastsTable.resolvedAt);
  const openRows = await db
    .select({ id: forecastsTable.id })
    .from(forecastsTable)
    .where(openWhere);

  let tenantName: string | null = null;
  if (tenantId) {
    const t = await db
      .select({ name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    tenantName = t[0]?.name ?? null;
  }

  return {
    scope: { kind: tenantId ? "tenant" : "system", tenantId, tenantName },
    threshold,
    baseline: NAIVE_BASELINE,
    headline,
    curve: calibrationCurve(points),
    byLayer: withLabel(aggregateBy(points, (p) => p.layerKey), threshold),
    byKind: withLabel(aggregateBy(points, (p) => p.kind), threshold),
    bySeat: withLabel(aggregateBy(points, (p) => p.subjectSeat), threshold),
    resolvedCount: points.length,
    openCount: openRows.length,
    ledger,
  };
}

// The calibration summary. With a tenantId the summary is scoped to that tenant
// and any seat that can reach it; without one it is the system-wide track record
// and is owner-only. The router is mounted behind requireAuth, so a session is
// guaranteed; the scope check is the only authorization done here.
calibrationRouter.get("/", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : null;
    if (tenantId) {
      const accessible = await resolveAccessibleTenantIds(user);
      if (!accessible.includes(tenantId)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    } else if (!isOwner(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const summary = await buildSummary(tenantId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

const resolveSchema = z.object({
  outcome: z.union([z.literal(0), z.literal(1)]),
  note: z.string().max(2000).optional(),
});

// Owner adjudication of a forecast. The owner supplies the realised outcome; the
// Brier score is computed server-side from the stored probability. Owner-only,
// since an adjudication writes the system's own track record.
calibrationRouter.post("/forecasts/:id/resolve", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!isOwner(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const result = await resolveForecastByOwner({
      forecastId: String(req.params.id),
      outcome: parsed.data.outcome,
      ownerUserId: user.id,
      note: parsed.data.note ?? null,
    });
    if (!result.ok) {
      res.status(result.reason === "not_found" ? 404 : 409).json({ error: result.reason });
      return;
    }
    res.json({ forecast: result.forecast });
  } catch (err) {
    next(err);
  }
});
