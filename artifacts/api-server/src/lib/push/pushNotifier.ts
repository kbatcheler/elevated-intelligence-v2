import { asc, eq, inArray } from "drizzle-orm";
import { db, pushEventsTable, usersTable, type PushChannel } from "@workspace/db";
import { stripDashes, type Logger } from "@workspace/cortex";
import { logger } from "../logger";
import { toNum } from "../outcomes/outcomeMath";
import { accessPairKey, resolveAccessiblePairsForUsers } from "../auth/tenantScope";
import { formatUsd, rankCandidates } from "./pushMath";

// The push digest drainer (Phase Z). It mirrors the Phase P alert notifier: the
// evaluator records pending push_events rows; this drainer claims them with
// SELECT ... FOR UPDATE SKIP LOCKED, groups them per recipient and channel,
// delivers one ranked digest per group exactly once, and flips every claimed row
// to sent or failed. A second tick or a second instance never re-sends a row
// another drainer holds.
//
// in_app is the always-available channel: there is no external sink, so an
// in_app group is acknowledged (sent) without leaving the host, and the row is
// already visible in the notification center. slack reuses the operator webhook;
// email is wired as an available-not-connected adapter that fails loudly and
// lazily when its endpoint is unset, never silently dropping a notification.

export interface PushDigestRecipient {
  userId: string;
  email: string | null;
}

export interface PushDigestLine {
  title: string;
  impactUsd: number | null;
  rankScore: number;
  sourceId: string;
}

export interface PushDigest {
  recipient: PushDigestRecipient;
  channel: PushChannel;
  lines: PushDigestLine[];
  totalEvents: number;
}

export interface PushTransport {
  readonly channel: PushChannel;
  deliver(digest: PushDigest): Promise<void>;
}

// Render the one operator/user-safe text block for a digest. Titles are already
// dash-stripped at the seam; stripDashes here is belt-and-suspenders on the
// assembled line, and formatUsd keeps the dollar figure ASCII-only.
export function formatPushDigestText(digest: PushDigest): string {
  const header =
    "Morning Brief: " +
    String(digest.totalEvents) +
    (digest.totalEvents === 1 ? " signal" : " signals");
  const body = digest.lines.map((l) => {
    const dollars = l.impactUsd === null ? "" : "[" + formatUsd(l.impactUsd) + "] ";
    return "- " + dollars + stripDashes(l.title);
  });
  return [header, ...body].join("\n");
}

function timeoutMsFromEnv(): number {
  const raw = process.env.PUSH_NOTIFIER_TIMEOUT_MS;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("push sink responded " + res.status);
  } finally {
    clearTimeout(timer);
  }
}

// The in-app channel: nothing leaves the host. The row is already in the center,
// so delivery is a no-op that always succeeds, exactly like the log sink default
// of the operational notifier.
export class InAppPushTransport implements PushTransport {
  readonly channel = "in_app" as const;
  constructor(private readonly log: Logger) {}
  async deliver(digest: PushDigest): Promise<void> {
    this.log.info(
      { recipient: digest.recipient.userId, signals: digest.totalEvents },
      "push digest available in notification center",
    );
  }
}

export class SlackPushTransport implements PushTransport {
  readonly channel = "slack" as const;
  constructor(
    private readonly webhookUrl: string,
    private readonly timeoutMs: number,
  ) {}
  async deliver(digest: PushDigest): Promise<void> {
    await postJson(this.webhookUrl, { text: formatPushDigestText(digest) }, this.timeoutMs);
  }
}

// The email channel, available but not connected until EMAIL_PUSH_ENDPOINT is
// set, mirroring the gcpSecretStore posture: construction validates nothing, and
// the first delivery fails with a precise, fixable error if the endpoint is
// missing. An email group with an unset endpoint therefore marks its events
// failed (visible in the center) rather than silently dropping them.
export class EmailPushTransport implements PushTransport {
  readonly channel = "email" as const;
  constructor(
    private readonly endpoint: string | undefined,
    private readonly timeoutMs: number,
  ) {}
  async deliver(digest: PushDigest): Promise<void> {
    if (!this.endpoint || this.endpoint.trim() === "") {
      throw new Error("set EMAIL_PUSH_ENDPOINT to connect the email push channel");
    }
    if (!digest.recipient.email) {
      throw new Error("recipient has no email address for the email push channel");
    }
    await postJson(
      this.endpoint.trim(),
      { to: digest.recipient.email, subject: "Morning Brief", text: formatPushDigestText(digest) },
      this.timeoutMs,
    );
  }
}

// Construct the transport for a channel. slack and email are honest about being
// unconnected: a slack group with no webhook, or an email group with no
// endpoint, fails loudly on deliver rather than pretending to send.
export function getPushTransport(channel: PushChannel, log: Logger = logger): PushTransport {
  if (channel === "slack") {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (url && url.trim() !== "") return new SlackPushTransport(url.trim(), timeoutMsFromEnv());
    return {
      channel: "slack",
      async deliver() {
        throw new Error("set SLACK_WEBHOOK_URL to connect the slack push channel");
      },
    };
  }
  if (channel === "email") {
    return new EmailPushTransport(process.env.EMAIL_PUSH_ENDPOINT, timeoutMsFromEnv());
  }
  return new InAppPushTransport(log);
}

export interface PushDrainResult {
  delivered: number;
  failed: number;
  groups: number;
}

function digestLimitFromEnv(): number {
  const raw = process.env.PUSH_DIGEST_LIMIT;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

const DEFAULT_CLAIM_LIMIT = 500;

// Drain pending push events to their channels exactly once each. The digest
// limit caps how many lines a single delivered message carries; every claimed
// row in a group is still resolved (the overflow remains in the notification
// center), so a row never lingers pending forever.
export async function drainPendingPushEvents(
  opts: {
    now?: Date;
    claimLimit?: number;
    digestLimit?: number;
    transportFor?: (channel: PushChannel) => PushTransport;
  } = {},
): Promise<PushDrainResult> {
  const claimLimit = opts.claimLimit ?? DEFAULT_CLAIM_LIMIT;
  const digestLimit = opts.digestLimit ?? digestLimitFromEnv();
  const transportFor = opts.transportFor ?? ((channel: PushChannel) => getPushTransport(channel));

  let delivered = 0;
  let failed = 0;
  let groups = 0;

  await db.transaction(async (tx) => {
    const allClaimed = await tx
      .select({
        id: pushEventsTable.id,
        ownerUserId: pushEventsTable.ownerUserId,
        tenantId: pushEventsTable.tenantId,
        channel: pushEventsTable.channel,
        title: pushEventsTable.title,
        impactUsd: pushEventsTable.impactUsd,
        rankScore: pushEventsTable.rankScore,
        sourceId: pushEventsTable.sourceId,
      })
      .from(pushEventsTable)
      .where(eq(pushEventsTable.deliveryStatus, "pending"))
      .orderBy(asc(pushEventsTable.createdAt))
      .limit(claimLimit)
      .for("update", { skipLocked: true });

    if (allClaimed.length === 0) return;

    // Re-verify access at delivery time. A row went pending under a binding that
    // may since have been revoked; delivering it to slack or email would leak a
    // tenant's business intelligence to a recipient who can no longer read it in
    // the center. Any claimed row whose (owner, tenant) pair is no longer
    // reachable is failed in place and never handed to a transport.
    const ownerIds = [...new Set(allClaimed.map((c) => c.ownerUserId))];
    const accessiblePairs = await resolveAccessiblePairsForUsers(ownerIds);
    const claimed: typeof allClaimed = [];
    const revokedIds: string[] = [];
    for (const row of allClaimed) {
      if (row.tenantId && accessiblePairs.has(accessPairKey(row.ownerUserId, row.tenantId))) {
        claimed.push(row);
      } else {
        revokedIds.push(row.id);
      }
    }
    if (revokedIds.length > 0) {
      await tx
        .update(pushEventsTable)
        .set({ deliveryStatus: "failed" })
        .where(inArray(pushEventsTable.id, revokedIds));
      failed += revokedIds.length;
      logger.warn(
        { count: revokedIds.length },
        "push digest rows failed without delivery: tenant access revoked since the event was recorded",
      );
    }
    if (claimed.length === 0) return;

    // Resolve recipient emails once for the email groups that need them.
    const userRows = await tx
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.id, [...new Set(claimed.map((c) => c.ownerUserId))]));
    const emailByUser = new Map(userRows.map((u) => [u.id, u.email]));

    // Group by (recipient, channel).
    const byGroup = new Map<string, typeof claimed>();
    for (const row of claimed) {
      const key = row.ownerUserId + "|" + row.channel;
      const list = byGroup.get(key) ?? [];
      list.push(row);
      byGroup.set(key, list);
    }

    for (const [, rows] of byGroup) {
      groups += 1;
      const first = rows[0]!;
      const ranked = rankCandidates(
        rows.map((r) => ({
          title: r.title,
          impactUsd: toNum(r.impactUsd),
          rankScore: toNum(r.rankScore) ?? 0,
          sourceId: r.sourceId,
        })),
      );
      const digest: PushDigest = {
        recipient: { userId: first.ownerUserId, email: emailByUser.get(first.ownerUserId) ?? null },
        channel: first.channel,
        lines: ranked.slice(0, digestLimit),
        totalEvents: rows.length,
      };
      const ids = rows.map((r) => r.id);
      try {
        await transportFor(first.channel).deliver(digest);
        await tx
          .update(pushEventsTable)
          .set({ deliveryStatus: "sent" })
          .where(inArray(pushEventsTable.id, ids));
        delivered += rows.length;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown error";
        logger.warn({ channel: first.channel, recipient: first.ownerUserId, err: reason }, "push digest delivery failed");
        await tx
          .update(pushEventsTable)
          .set({ deliveryStatus: "failed" })
          .where(inArray(pushEventsTable.id, ids));
        failed += rows.length;
      }
    }
  });

  return { delivered, failed, groups };
}
