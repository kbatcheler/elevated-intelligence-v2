import { asc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import {
  committedActionsTable,
  db,
  layersTable,
  orgsTable,
  orgTenantsTable,
  outcomeMeasurementsTable,
  tenantLayersTable,
  tenantsTable,
} from "@workspace/db";
import { isProvider } from "../lib/auth/access";
import { computeOutcomeSummary, toNum } from "../lib/outcomes/outcomeMath";
import {
  summarizePortfolio,
  type PortfolioLayerInput,
  type PortfolioScope,
  type PortfolioTenantInput,
} from "../lib/portfolio/portfolioMath";

// The Portfolio Intelligence view (Phase Y). One read assembles the ranked
// multi-company board, the cross-portfolio gap patterns, and the per-company
// completeness an investor or operator needs. The portfolio org type predates
// this phase (Phase D); this route is only the experience over it.
//
// The scope is resolved server-side from the session alone, never from anything
// the client sends. A provider seat sees every tenant as a portfolio; a seat in
// a portfolio org sees only the tenants its org is bound to through org_tenants;
// every other seat (a client org, or a user with no org) is refused with 403
// portfolio_only. This reuses the Phase T access posture: a portfolio caller can
// never name a tenant outside its own bindings, because it never names a tenant
// at all.
export const portfolioRouter: Router = Router();

// Local jsonb projectors, the same defensive posture as the tenants router: a
// malformed stored value becomes null rather than a fabricated stand-in, so no
// figure is ever invented from bad data.
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? (v.filter((x) => x != null && typeof x === "object") as Record<string, unknown>[])
    : [];
}
function asGapKind(v: unknown): "DATA" | "SIGNAL" | "INTEG" | "MODEL" | "FLOW" | null {
  return v === "DATA" || v === "SIGNAL" || v === "INTEG" || v === "MODEL" || v === "FLOW" ? v : null;
}

portfolioRouter.get("/summary", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    // Resolve scope and the tenant id set entirely from the session.
    let scope: PortfolioScope;
    let tenantIds: string[];

    if (isProvider(user.role)) {
      let orgName: string | null = null;
      if (user.orgId) {
        const org = (
          await db.select({ name: orgsTable.name }).from(orgsTable).where(eq(orgsTable.id, user.orgId)).limit(1)
        )[0];
        orgName = org?.name ?? null;
      }
      scope = { type: "provider", orgId: user.orgId, orgName };
      const all = await db.select({ id: tenantsTable.id }).from(tenantsTable);
      tenantIds = all.map((t) => t.id);
    } else {
      if (!user.orgId || user.orgType !== "portfolio") {
        res.status(403).json({ error: "portfolio_only" });
        return;
      }
      const org = (
        await db.select({ name: orgsTable.name }).from(orgsTable).where(eq(orgsTable.id, user.orgId)).limit(1)
      )[0];
      scope = { type: "portfolio", orgId: user.orgId, orgName: org?.name ?? null };
      const bindings = await db
        .select({ tenantId: orgTenantsTable.tenantId })
        .from(orgTenantsTable)
        .where(eq(orgTenantsTable.orgId, user.orgId));
      tenantIds = bindings.map((b) => b.tenantId);
    }

    // An empty scope is an honest empty board, not an error.
    if (tenantIds.length === 0) {
      res.json({ portfolio: summarizePortfolio(scope, []) });
      return;
    }

    const [tenantRows, layerRows, tenantLayerRows, actionRows, measurementRows] = await Promise.all([
      db
        .select({
          id: tenantsTable.id,
          name: tenantsTable.name,
          status: tenantsTable.status,
          dataMode: tenantsTable.dataMode,
        })
        .from(tenantsTable)
        .where(inArray(tenantsTable.id, tenantIds)),
      db
        .select({ key: layersTable.key, name: layersTable.name })
        .from(layersTable)
        .orderBy(asc(layersTable.sortOrder)),
      db
        .select({
          tenantId: tenantLayersTable.tenantId,
          layerKey: tenantLayersTable.layerKey,
          content: tenantLayersTable.content,
        })
        .from(tenantLayersTable)
        .where(inArray(tenantLayersTable.tenantId, tenantIds)),
      db
        .select({
          id: committedActionsTable.id,
          tenantId: committedActionsTable.tenantId,
          predictedValueUsd: committedActionsTable.predictedValueUsd,
          status: committedActionsTable.status,
        })
        .from(committedActionsTable)
        .where(inArray(committedActionsTable.tenantId, tenantIds)),
      db
        .select({
          actionId: outcomeMeasurementsTable.actionId,
          tenantId: committedActionsTable.tenantId,
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
        .where(inArray(committedActionsTable.tenantId, tenantIds)),
    ]);

    const contentByTenant = new Map<string, Map<string, Record<string, unknown>>>();
    for (const r of tenantLayerRows) {
      let m = contentByTenant.get(r.tenantId);
      if (!m) {
        m = new Map();
        contentByTenant.set(r.tenantId, m);
      }
      m.set(r.layerKey, r.content);
    }

    const actionsByTenant = new Map<
      string,
      { id: string; predictedValueUsd: number | null; status: (typeof actionRows)[number]["status"] }[]
    >();
    for (const a of actionRows) {
      const list = actionsByTenant.get(a.tenantId) ?? [];
      list.push({ id: a.id, predictedValueUsd: toNum(a.predictedValueUsd), status: a.status });
      actionsByTenant.set(a.tenantId, list);
    }

    const measurementsByTenant = new Map<
      string,
      {
        actionId: string;
        realizedValueUsd: number | null;
        status: (typeof measurementRows)[number]["status"];
        measuredAt: number;
        createdAt: number;
      }[]
    >();
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

    const inputs: PortfolioTenantInput[] = tenantRows.map((t) => {
      const contentMap = contentByTenant.get(t.id) ?? new Map<string, Record<string, unknown>>();
      const layers: PortfolioLayerInput[] = layerRows.map((l) => {
        const content = contentMap.get(l.key) ?? null;
        const gaps = content
          ? asObjectArray(content.gaps).map((g) => ({
              kind: asGapKind(g.kind),
              description: asString(g.description),
              confidenceLiftPp: asNumber(g.confidence_lift_pp),
            }))
          : [];
        return {
          layerKey: l.key,
          layerName: l.name,
          generated: content != null,
          confidence: content ? asNumber(content.confidence) : null,
          gaps,
        };
      });
      const outcomes = computeOutcomeSummary(
        actionsByTenant.get(t.id) ?? [],
        measurementsByTenant.get(t.id) ?? [],
      );
      return {
        tenantId: t.id,
        tenantName: t.name,
        status: t.status,
        dataMode: t.dataMode,
        layers,
        outcomes,
      };
    });

    res.json({ portfolio: summarizePortfolio(scope, inputs) });
  } catch (err) {
    next(err);
  }
});
