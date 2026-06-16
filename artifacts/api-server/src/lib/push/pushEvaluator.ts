import { and, eq, inArray, type SQL } from "drizzle-orm";
import {
  committedActionsTable,
  db,
  decisionRecordsTable,
  orgsTable,
  orgTenantsTable,
  outcomeMeasurementsTable,
  preMortemIndicatorsTable,
  pushEventsTable,
  pushRulesTable,
  tenantsTable,
  usersTable,
  type InsertPushEvent,
  type InsertPushRule,
  type PushRuleType,
} from "@workspace/db";
import { stripDashes } from "@workspace/cortex";
import { isProvider } from "../auth/access";
import { accessPairKey } from "../auth/tenantScope";
import { latestMeasurementPerAction, toNum, type MeasurementValue } from "../outcomes/outcomeMath";
import {
  computeRankScore,
  evaluateSuppression,
  formatUsd,
  highValueDedupeKey,
  premortemIndicatorDedupeKey,
  shortfallDedupeKey,
  type PushThresholds,
} from "./pushMath";

// The evaluator turns persisted state into recorded notifications (Phase Z). It
// does three things each pass, all idempotently:
//
//   1. Materialize a default rule (enabled, no floor) for every (user, tenant,
//      kind) a user can reach, so a fresh seat has a tunable surface and the
//      scheduled brief reaches everyone, not only those who have visited a page.
//   2. Build candidate breaches from real rows: an outcome shortfall is a graded
//      missed measurement; a high-value action is an open committed action with a
//      dollar prediction. Every figure is computed, never fabricated.
//   3. For each enabled rule, score and either record a pending event or a
//      suppressed one, inserting with ON CONFLICT (ruleId, dedupeKey) DO NOTHING
//      so the same breach in the same state never notifies twice.
//
// Delivery to a channel is a separate concern (pushNotifier drains the pending
// rows), exactly as the Phase P notifier drains the operational alert seam.

const RULE_TYPES: readonly PushRuleType[] = [
  "outcome_shortfall",
  "high_value_action",
  "premortem_indicator",
];

export interface PushEvaluationLogger {
  info(fields: Record<string, unknown>, msg: string): void;
}

export interface PushEvaluationOutcome {
  rulesEvaluated: number;
  created: number;
  pending: number;
  suppressed: number;
}

// Materialize default rules for the given (owner, tenant) pairs across every
// implemented kind. ON CONFLICT DO NOTHING makes it safe to call repeatedly and
// from several places (the scheduled pass for all users, a route for one user).
export async function ensureDefaultRules(
  pairs: readonly { ownerUserId: string; tenantId: string }[],
): Promise<void> {
  if (pairs.length === 0) return;
  const values: InsertPushRule[] = [];
  for (const p of pairs) {
    for (const type of RULE_TYPES) {
      values.push({ ownerUserId: p.ownerUserId, tenantId: p.tenantId, type });
    }
  }
  const CHUNK = 200;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(pushRulesTable).values(values.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

interface Candidate {
  type: PushRuleType;
  tenantId: string;
  sourceType: string;
  sourceId: string;
  dedupeKey: string;
  title: string;
  message: string;
  impactUsd: number | null;
  confidence: number | null;
}

// Build the candidate breaches for a set of tenants from their actions and the
// latest measurement of each action. Pure over already-loaded rows.
function buildCandidates(
  actions: {
    id: string;
    tenantId: string;
    title: string;
    predictedValueUsd: number | null;
    confidence: number;
    status: "committed" | "in_progress" | "done" | "dismissed";
  }[],
  measurements: {
    id: string;
    actionId: string;
    tenantId: string;
    realizedValueUsd: number | null;
    status: MeasurementValue["status"];
    measuredAt: number;
    createdAt: number;
  }[],
  // Pre-mortem indicators already fenced to active/triggered on a COMMIT decision
  // whose committed action is still open. Each is a real, watched early-warning
  // sign for value genuinely at stake.
  indicators: {
    id: string;
    tenantId: string;
    status: "active" | "triggered";
    failureModeTitle: string;
    label: string;
    recommendedTitle: string;
    recommendedValueUsd: number | null;
    systemConfidence: number;
  }[],
): Map<string, Map<PushRuleType, Candidate[]>> {
  const byTenant = new Map<string, Map<PushRuleType, Candidate[]>>();
  const push = (type: PushRuleType, c: Candidate): void => {
    let perType = byTenant.get(c.tenantId);
    if (!perType) {
      perType = new Map();
      byTenant.set(c.tenantId, perType);
    }
    const list = perType.get(type) ?? [];
    list.push(c);
    perType.set(type, list);
  };

  const actionById = new Map(actions.map((a) => [a.id, a]));

  // High-value action: an open committed action carrying a dollar prediction.
  for (const a of actions) {
    if (a.status !== "committed" && a.status !== "in_progress") continue;
    if (a.predictedValueUsd === null) continue;
    const title = stripDashes(a.title);
    push("high_value_action", {
      type: "high_value_action",
      tenantId: a.tenantId,
      sourceType: "committed_action",
      sourceId: a.id,
      dedupeKey: highValueDedupeKey(a.id),
      title: "High value action: " + title,
      message:
        title +
        " carries " +
        formatUsd(a.predictedValueUsd) +
        " of predicted value at " +
        String(a.confidence) +
        " percent confidence.",
      impactUsd: a.predictedValueUsd,
      confidence: a.confidence,
    });
  }

  // Outcome shortfall: the latest measurement of an action graded missed, with a
  // positive dollar shortfall against the prediction.
  const latest = latestMeasurementPerAction(
    measurements.map((m) => ({
      actionId: m.actionId,
      realizedValueUsd: m.realizedValueUsd,
      status: m.status,
      measuredAt: m.measuredAt,
      createdAt: m.createdAt,
    })),
  );
  const measurementRowByActionId = new Map<string, (typeof measurements)[number]>();
  for (const m of measurements) {
    const prev = measurementRowByActionId.get(m.actionId);
    if (!prev || m.measuredAt > prev.measuredAt || (m.measuredAt === prev.measuredAt && m.createdAt > prev.createdAt)) {
      measurementRowByActionId.set(m.actionId, m);
    }
  }
  for (const l of latest) {
    if (l.status !== "missed") continue;
    const action = actionById.get(l.actionId);
    const row = measurementRowByActionId.get(l.actionId);
    if (!action || !row) continue;
    if (action.predictedValueUsd === null || l.realizedValueUsd === null) continue;
    const shortfall = action.predictedValueUsd - l.realizedValueUsd;
    if (!(shortfall > 0)) continue;
    const title = stripDashes(action.title);
    push("outcome_shortfall", {
      type: "outcome_shortfall",
      tenantId: action.tenantId,
      sourceType: "outcome_measurement",
      sourceId: row.id,
      dedupeKey: shortfallDedupeKey(row.id),
      title: "Outcome missed: " + title,
      message:
        title +
        " realized " +
        formatUsd(l.realizedValueUsd) +
        " against " +
        formatUsd(action.predictedValueUsd) +
        " predicted, a shortfall of " +
        formatUsd(shortfall) +
        ".",
      impactUsd: shortfall,
      confidence: action.confidence,
    });
  }

  // Pre-mortem indicator: an early-warning sign on an open committed action. An
  // active indicator surfaces once as a watch item; the same indicator notifies
  // AGAIN when it transitions to triggered (its sign was actually observed). The
  // dollars at stake are the decision's recommended value and the confidence is
  // the system's confidence in the recommendation, both real persisted figures.
  for (const ind of indicators) {
    const actionTitle = stripDashes(ind.recommendedTitle);
    const failureMode = stripDashes(ind.failureModeTitle);
    const sign = stripDashes(ind.label);
    const fired = ind.status === "triggered";
    push("premortem_indicator", {
      type: "premortem_indicator",
      tenantId: ind.tenantId,
      sourceType: "premortem_indicator",
      sourceId: ind.id,
      dedupeKey: premortemIndicatorDedupeKey(ind.id, ind.status),
      title: (fired ? "Early warning fired: " : "Watch: ") + failureMode,
      message:
        (fired
          ? "An early-warning sign was observed for committed action "
          : "Watch for an early-warning sign on committed action ") +
        actionTitle +
        ": " +
        sign +
        ".",
      impactUsd: ind.recommendedValueUsd,
      confidence: ind.systemConfidence,
    });
  }

  return byTenant;
}

export async function runPushEvaluation(deps: {
  now: Date;
  log?: PushEvaluationLogger;
  // Optional scoping seams. Unset (the scheduled Morning Brief) means the whole
  // platform: every active user, every tenant they reach. Set to confine a pass
  // to a subset, so an integration test can drive the evaluator hermetically
  // against only its own seeded users and tenants without touching global state.
  restrictToUserIds?: readonly string[];
  restrictToTenantIds?: readonly string[];
}): Promise<PushEvaluationOutcome> {
  const nowMs = deps.now.getTime();
  const tenantFilter = deps.restrictToTenantIds ? new Set(deps.restrictToTenantIds) : null;

  // 1. Resolve who sees what, and ensure a default rule per (user, tenant, kind).
  const userConds: SQL[] = [eq(usersTable.status, "active")];
  if (deps.restrictToUserIds) {
    userConds.push(inArray(usersTable.id, [...deps.restrictToUserIds]));
  }
  const users = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      orgId: usersTable.orgId,
      orgType: orgsTable.type,
    })
    .from(usersTable)
    .leftJoin(orgsTable, eq(orgsTable.id, usersTable.orgId))
    .where(and(...userConds));

  const allTenantIds = (await db.select({ id: tenantsTable.id }).from(tenantsTable)).map((t) => t.id);
  const allBindings = await db
    .select({ orgId: orgTenantsTable.orgId, tenantId: orgTenantsTable.tenantId })
    .from(orgTenantsTable);
  const bindingsByOrg = new Map<string, string[]>();
  for (const b of allBindings) {
    const list = bindingsByOrg.get(b.orgId) ?? [];
    list.push(b.tenantId);
    bindingsByOrg.set(b.orgId, list);
  }

  const pairs: { ownerUserId: string; tenantId: string }[] = [];
  for (const u of users) {
    const reachable = isProvider(u.role)
      ? allTenantIds
      : u.orgId
        ? (bindingsByOrg.get(u.orgId) ?? [])
        : [];
    const accessible = tenantFilter ? reachable.filter((id) => tenantFilter.has(id)) : reachable;
    for (const tenantId of accessible) pairs.push({ ownerUserId: u.id, tenantId });
  }
  await ensureDefaultRules(pairs);

  // The set of (user, tenant) pairs reachable RIGHT NOW. A rule whose tenant
  // binding was removed since it was created still sits enabled in the table, so
  // loading by enablement alone would let the scheduled pass mint events (and a
  // delivered digest) for a tenant the user can no longer see. Fencing the loaded
  // rules to this set is the same access boundary the HTTP routes enforce.
  const accessiblePairs = new Set(pairs.map((p) => accessPairKey(p.ownerUserId, p.tenantId)));

  // 2. Load enabled rules. A disabled rule produces no events at all; a muted
  // rule still evaluates but records suppressed events, so a mute hides noise
  // without losing the record. The same optional scoping seams confine the load
  // to a subset, so a test pass never reads another suite's rules.
  const ruleConds: SQL[] = [eq(pushRulesTable.enabled, true)];
  if (deps.restrictToUserIds) {
    ruleConds.push(inArray(pushRulesTable.ownerUserId, [...deps.restrictToUserIds]));
  }
  if (deps.restrictToTenantIds) {
    ruleConds.push(inArray(pushRulesTable.tenantId, [...deps.restrictToTenantIds]));
  }
  const loadedRules = await db
    .select({
      id: pushRulesTable.id,
      tenantId: pushRulesTable.tenantId,
      ownerUserId: pushRulesTable.ownerUserId,
      type: pushRulesTable.type,
      mutedUntil: pushRulesTable.mutedUntil,
      minImpactUsd: pushRulesTable.minImpactUsd,
      minConfidence: pushRulesTable.minConfidence,
      channel: pushRulesTable.channel,
    })
    .from(pushRulesTable)
    .where(and(...ruleConds));

  // Fence the loaded rules to the pairs reachable right now. A rule on a tenant
  // whose binding was revoked is dropped here, so no new event is minted for it.
  const rules = loadedRules.filter((r) => accessiblePairs.has(accessPairKey(r.ownerUserId, r.tenantId)));

  if (rules.length === 0) {
    return { rulesEvaluated: 0, created: 0, pending: 0, suppressed: 0 };
  }

  // 3. Load the candidate domain data for exactly the tenants those rules watch.
  const tenantIds = [...new Set(rules.map((r) => r.tenantId))];
  const actionRows = await db
    .select({
      id: committedActionsTable.id,
      tenantId: committedActionsTable.tenantId,
      title: committedActionsTable.title,
      predictedValueUsd: committedActionsTable.predictedValueUsd,
      confidence: committedActionsTable.confidence,
      status: committedActionsTable.status,
    })
    .from(committedActionsTable)
    .where(inArray(committedActionsTable.tenantId, tenantIds));

  const measurementRows = await db
    .select({
      id: outcomeMeasurementsTable.id,
      actionId: outcomeMeasurementsTable.actionId,
      tenantId: committedActionsTable.tenantId,
      realizedValueUsd: outcomeMeasurementsTable.realizedValueUsd,
      status: outcomeMeasurementsTable.status,
      measuredAt: outcomeMeasurementsTable.measuredAt,
      createdAt: outcomeMeasurementsTable.createdAt,
    })
    .from(outcomeMeasurementsTable)
    .innerJoin(committedActionsTable, eq(outcomeMeasurementsTable.actionId, committedActionsTable.id))
    .where(inArray(committedActionsTable.tenantId, tenantIds));

  // Pre-mortem indicators worth watching: active or triggered, on a COMMIT
  // decision whose committed action is still open. A cleared indicator, a defer or
  // reject decision, or a done/dismissed action is excluded by the join, so the
  // evaluator only ever surfaces a live watch against value still at stake.
  const indicatorRows = await db
    .select({
      id: preMortemIndicatorsTable.id,
      tenantId: preMortemIndicatorsTable.tenantId,
      status: preMortemIndicatorsTable.status,
      failureModeTitle: preMortemIndicatorsTable.failureModeTitle,
      label: preMortemIndicatorsTable.label,
      recommendedTitle: decisionRecordsTable.recommendedTitle,
      recommendedValueUsd: decisionRecordsTable.recommendedValueUsd,
      systemConfidence: decisionRecordsTable.systemConfidence,
    })
    .from(preMortemIndicatorsTable)
    .innerJoin(
      decisionRecordsTable,
      eq(preMortemIndicatorsTable.decisionRecordId, decisionRecordsTable.id),
    )
    .innerJoin(
      committedActionsTable,
      eq(decisionRecordsTable.committedActionId, committedActionsTable.id),
    )
    .where(
      and(
        inArray(preMortemIndicatorsTable.tenantId, tenantIds),
        inArray(preMortemIndicatorsTable.status, ["active", "triggered"]),
        eq(decisionRecordsTable.decision, "commit"),
        inArray(committedActionsTable.status, ["committed", "in_progress"]),
      ),
    );

  const candidatesByTenant = buildCandidates(
    actionRows.map((a) => ({
      id: a.id,
      tenantId: a.tenantId,
      title: a.title,
      predictedValueUsd: toNum(a.predictedValueUsd),
      confidence: a.confidence,
      status: a.status,
    })),
    measurementRows.map((m) => ({
      id: m.id,
      actionId: m.actionId,
      tenantId: m.tenantId,
      realizedValueUsd: toNum(m.realizedValueUsd),
      status: m.status,
      measuredAt: m.measuredAt.getTime(),
      createdAt: m.createdAt.getTime(),
    })),
    indicatorRows.map((i) => ({
      id: i.id,
      tenantId: i.tenantId,
      status: i.status === "triggered" ? ("triggered" as const) : ("active" as const),
      failureModeTitle: i.failureModeTitle,
      label: i.label,
      recommendedTitle: i.recommendedTitle,
      recommendedValueUsd: toNum(i.recommendedValueUsd),
      systemConfidence: i.systemConfidence,
    })),
  );

  // 4. Score each candidate under each rule and stage an insert row.
  const toInsert: InsertPushEvent[] = [];
  for (const rule of rules) {
    const candidates = candidatesByTenant.get(rule.tenantId)?.get(rule.type) ?? [];
    if (candidates.length === 0) continue;
    const thresholds: PushThresholds = {
      enabled: true,
      mutedUntil: rule.mutedUntil ? rule.mutedUntil.getTime() : null,
      minImpactUsd: toNum(rule.minImpactUsd),
      minConfidence: rule.minConfidence,
    };
    for (const c of candidates) {
      const rankScore = computeRankScore(c.impactUsd, c.confidence);
      const { suppressed } = evaluateSuppression({
        impactUsd: c.impactUsd,
        confidence: c.confidence,
        thresholds,
        now: nowMs,
      });
      toInsert.push({
        ruleId: rule.id,
        ownerUserId: rule.ownerUserId,
        tenantId: rule.tenantId,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        dedupeKey: c.dedupeKey,
        title: c.title,
        message: c.message,
        impactUsd: c.impactUsd === null ? null : c.impactUsd.toFixed(2),
        confidence: c.confidence,
        rankScore: rankScore.toFixed(4),
        deliveryStatus: suppressed ? "suppressed" : "pending",
        channel: rule.channel,
      });
    }
  }

  let created = 0;
  let pending = 0;
  let suppressed = 0;
  const CHUNK = 200;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const inserted = await db
      .insert(pushEventsTable)
      .values(slice)
      .onConflictDoNothing({ target: [pushEventsTable.ruleId, pushEventsTable.dedupeKey] })
      .returning({ deliveryStatus: pushEventsTable.deliveryStatus });
    for (const row of inserted) {
      created += 1;
      if (row.deliveryStatus === "pending") pending += 1;
      else if (row.deliveryStatus === "suppressed") suppressed += 1;
    }
  }

  if (created > 0 && deps.log) {
    deps.log.info(
      { rulesEvaluated: rules.length, created, pending, suppressed },
      "push evaluation recorded events",
    );
  }

  return { rulesEvaluated: rules.length, created, pending, suppressed };
}
