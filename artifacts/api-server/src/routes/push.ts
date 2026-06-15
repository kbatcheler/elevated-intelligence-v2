import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  pushEventsTable,
  pushRulesTable,
  tenantsTable,
  type PushChannel,
} from "@workspace/db";
import { toNum } from "../lib/outcomes/outcomeMath";
import { ensureDefaultRules } from "../lib/push/pushEvaluator";
import { resolveAccessibleTenantIds } from "../lib/auth/tenantScope";

// The Proactive Push Intelligence surface (Phase Z). Every route is per-user and
// double-fenced: a row must belong to the caller (ownerUserId = me) AND concern a
// tenant the caller can currently reach (resolveAccessibleTenantIds). The
// notification center shows suppressed events too, visually distinct from
// delivered ones, so tuning a threshold never silently loses signal. Mounted
// under the shared session gate in app.ts, so requireAuth has already run.
export const pushRouter: Router = Router();

const VALID_CHANNELS: readonly PushChannel[] = ["in_app", "slack", "email"];
const MAX_MUTE_HOURS = 24 * 30;
const LIST_LIMIT = 200;

// An event is unread when the user has not opened it and it was actually
// surfaced: pending, sent or failed. A suppressed event is shown in the center
// but never counts as unread, so a muted or below-threshold breach does not
// inflate the bell badge.
const UNREAD_STATUSES = ["pending", "sent", "failed"] as const;

function serializeEvent(row: {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  sourceType: string;
  sourceId: string;
  title: string;
  message: string;
  impactUsd: string | null;
  confidence: number | null;
  rankScore: string;
  deliveryStatus: string;
  channel: string;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    title: row.title,
    message: row.message,
    impactUsd: toNum(row.impactUsd),
    confidence: row.confidence,
    rankScore: toNum(row.rankScore) ?? 0,
    deliveryStatus: row.deliveryStatus,
    channel: row.channel,
    read: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeRule(row: {
  id: string;
  tenantId: string;
  tenantName: string | null;
  type: string;
  enabled: boolean;
  mutedUntil: Date | null;
  minImpactUsd: string | null;
  minConfidence: number | null;
  channel: string;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    type: row.type,
    enabled: row.enabled,
    mutedUntil: row.mutedUntil ? row.mutedUntil.toISOString() : null,
    minImpactUsd: toNum(row.minImpactUsd),
    minConfidence: row.minConfidence,
    channel: row.channel,
  };
}

// GET /notifications - the in-app center. Ensures a default rule per reachable
// tenant first so a fresh seat is never empty for the wrong reason, then lists
// the caller's most recent events fenced to reachable tenants, with the unread
// count computed over the full set rather than the capped page.
pushRouter.get("/notifications", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const accessible = await resolveAccessibleTenantIds(user);
    if (accessible.length === 0) {
      res.json({ notifications: [], unreadCount: 0 });
      return;
    }
    await ensureDefaultRules(accessible.map((tenantId) => ({ ownerUserId: user.id, tenantId })));

    const rows = await db
      .select({
        id: pushEventsTable.id,
        tenantId: pushEventsTable.tenantId,
        tenantName: tenantsTable.name,
        sourceType: pushEventsTable.sourceType,
        sourceId: pushEventsTable.sourceId,
        title: pushEventsTable.title,
        message: pushEventsTable.message,
        impactUsd: pushEventsTable.impactUsd,
        confidence: pushEventsTable.confidence,
        rankScore: pushEventsTable.rankScore,
        deliveryStatus: pushEventsTable.deliveryStatus,
        channel: pushEventsTable.channel,
        readAt: pushEventsTable.readAt,
        createdAt: pushEventsTable.createdAt,
      })
      .from(pushEventsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, pushEventsTable.tenantId))
      .where(
        and(
          eq(pushEventsTable.ownerUserId, user.id),
          inArray(pushEventsTable.tenantId, accessible),
        ),
      )
      .orderBy(desc(pushEventsTable.createdAt))
      .limit(LIST_LIMIT);

    const unread = await db
      .select({ value: count() })
      .from(pushEventsTable)
      .where(
        and(
          eq(pushEventsTable.ownerUserId, user.id),
          inArray(pushEventsTable.tenantId, accessible),
          inArray(pushEventsTable.deliveryStatus, [...UNREAD_STATUSES]),
          isNull(pushEventsTable.readAt),
        ),
      );

    res.json({
      notifications: rows.map(serializeEvent),
      unreadCount: Number(unread[0]?.value ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/:id/read - mark one of my events read. Fenced to my rows
// and to reachable tenants; a 404 (never 403) avoids leaking whether an id
// belonging to someone else exists.
pushRouter.post("/notifications/:id/read", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const accessible = await resolveAccessibleTenantIds(user);
    if (accessible.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const updated = await db
      .update(pushEventsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(pushEventsTable.id, String(req.params.id)),
          eq(pushEventsTable.ownerUserId, user.id),
          inArray(pushEventsTable.tenantId, accessible),
        ),
      )
      .returning({ id: pushEventsTable.id });
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/read-all - mark every surfaced, unread event of mine read.
pushRouter.post("/notifications/read-all", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const accessible = await resolveAccessibleTenantIds(user);
    if (accessible.length === 0) {
      res.json({ ok: true, marked: 0 });
      return;
    }
    const updated = await db
      .update(pushEventsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(pushEventsTable.ownerUserId, user.id),
          inArray(pushEventsTable.tenantId, accessible),
          inArray(pushEventsTable.deliveryStatus, [...UNREAD_STATUSES]),
          isNull(pushEventsTable.readAt),
        ),
      )
      .returning({ id: pushEventsTable.id });
    res.json({ ok: true, marked: updated.length });
  } catch (err) {
    next(err);
  }
});

// GET /rules - my tunable rules across reachable tenants, defaults materialized
// first so the list is never empty for a seat that can see tenants.
pushRouter.get("/rules", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const accessible = await resolveAccessibleTenantIds(user);
    if (accessible.length === 0) {
      res.json({ rules: [] });
      return;
    }
    await ensureDefaultRules(accessible.map((tenantId) => ({ ownerUserId: user.id, tenantId })));

    const rows = await db
      .select({
        id: pushRulesTable.id,
        tenantId: pushRulesTable.tenantId,
        tenantName: tenantsTable.name,
        type: pushRulesTable.type,
        enabled: pushRulesTable.enabled,
        mutedUntil: pushRulesTable.mutedUntil,
        minImpactUsd: pushRulesTable.minImpactUsd,
        minConfidence: pushRulesTable.minConfidence,
        channel: pushRulesTable.channel,
      })
      .from(pushRulesTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, pushRulesTable.tenantId))
      .where(
        and(
          eq(pushRulesTable.ownerUserId, user.id),
          inArray(pushRulesTable.tenantId, accessible),
        ),
      )
      .orderBy(desc(pushRulesTable.createdAt));

    res.json({ rules: rows.map(serializeRule) });
  } catch (err) {
    next(err);
  }
});

// PATCH /rules/:id - tune a rule's enablement, thresholds or channel. A null
// threshold clears the floor (every breach qualifies); a number sets it. The
// patch only ever touches my own rule on a reachable tenant.
pushRouter.patch("/rules/:id", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: {
      enabled?: boolean;
      minImpactUsd?: string | null;
      minConfidence?: number | null;
      channel?: PushChannel;
    } = {};

    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        res.status(400).json({ error: "enabled_must_be_boolean" });
        return;
      }
      patch.enabled = body.enabled;
    }
    if ("minImpactUsd" in body) {
      const v = body.minImpactUsd;
      if (v === null) {
        patch.minImpactUsd = null;
      } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        patch.minImpactUsd = v.toFixed(2);
      } else {
        res.status(400).json({ error: "min_impact_usd_invalid" });
        return;
      }
    }
    if ("minConfidence" in body) {
      const v = body.minConfidence;
      if (v === null) {
        patch.minConfidence = null;
      } else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100) {
        patch.minConfidence = v;
      } else {
        res.status(400).json({ error: "min_confidence_invalid" });
        return;
      }
    }
    if ("channel" in body) {
      if (!VALID_CHANNELS.includes(body.channel as PushChannel)) {
        res.status(400).json({ error: "channel_invalid" });
        return;
      }
      patch.channel = body.channel as PushChannel;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no_fields" });
      return;
    }

    const accessible = await resolveAccessibleTenantIds(user);
    if (accessible.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const updated = await db
      .update(pushRulesTable)
      .set(patch)
      .where(
        and(
          eq(pushRulesTable.id, String(req.params.id)),
          eq(pushRulesTable.ownerUserId, user.id),
          inArray(pushRulesTable.tenantId, accessible),
        ),
      )
      .returning({ id: pushRulesTable.id });
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /rules/:id/mute - mute a rule for a number of hours, or unmute with 0.
// A muted rule still evaluates but records suppressed events, so the high-signal
// history is never lost while the noise is hidden.
pushRouter.post("/rules/:id/mute", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hours = body.hours;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 || hours > MAX_MUTE_HOURS) {
      res.status(400).json({ error: "hours_invalid" });
      return;
    }
    const mutedUntil = hours === 0 ? null : new Date(Date.now() + hours * 60 * 60 * 1000);

    const accessible = await resolveAccessibleTenantIds(user);
    if (accessible.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const updated = await db
      .update(pushRulesTable)
      .set({ mutedUntil })
      .where(
        and(
          eq(pushRulesTable.id, String(req.params.id)),
          eq(pushRulesTable.ownerUserId, user.id),
          inArray(pushRulesTable.tenantId, accessible),
        ),
      )
      .returning({ id: pushRulesTable.id });
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true, mutedUntil: mutedUntil ? mutedUntil.toISOString() : null });
  } catch (err) {
    next(err);
  }
});
