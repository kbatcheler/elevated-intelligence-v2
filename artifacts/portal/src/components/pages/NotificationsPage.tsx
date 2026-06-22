import React, { useCallback, useEffect, useState } from "react";
import type {
  PushChannel,
  PushDeliveryStatus,
  PushNotification,
  PushNotifications,
  PushRule,
  PushRuleType,
} from "../../types";
import { useAuth } from "../../lib/AuthContext";
import {
  fetchNotifications,
  fetchPushRules,
  markAllNotificationsRead,
  markNotificationRead,
  mutePushRule,
  patchPushRule,
  type MutationOutcome,
} from "../../lib/pushApi";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  Pill,
  SectionHeading,
  SkeletonLines,
} from "../primitives";
import { formatDateTime, formatUsd, pct } from "../primitives/format";

// The Proactive Push Intelligence notification center (Phase Z). Two honest
// reads compose the page: the recorded events (the inbox) and the tunable rules.
// Every figure is rendered straight from the server, which computes it from
// persisted state; an event with no dollar prediction shows a plain dash and a
// suppressed event is shown distinct from a delivered one, so tuning a threshold
// or muting a rule hides noise without ever losing the high-signal history.
type Center =
  | { kind: "loading" }
  | { kind: "ready"; data: PushNotifications }
  | { kind: "error" };

type RulesState =
  | { kind: "loading" }
  | { kind: "ready"; rules: PushRule[] }
  | { kind: "error" };

const STATUS_PILL: Record<PushDeliveryStatus, { color: "navy" | "teal" | "red" | "gray"; label: string }> = {
  pending: { color: "navy", label: "Pending" },
  sent: { color: "teal", label: "Delivered" },
  failed: { color: "red", label: "Failed" },
  suppressed: { color: "gray", label: "Suppressed" },
};

const TYPE_LABEL: Record<PushRuleType, string> = {
  outcome_shortfall: "Outcome shortfall",
  high_value_action: "High value action",
};

const CHANNEL_LABEL: Record<PushChannel, string> = {
  in_app: "In-app",
  slack: "Slack",
  email: "Email",
};

export function NotificationsPage() {
  const { logout } = useAuth();
  const [center, setCenter] = useState<Center>({ kind: "loading" });
  const [rules, setRules] = useState<RulesState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const loadCenter = useCallback(async () => {
    const out = await fetchNotifications();
    if ("unauthorized" in out) {
      logout();
      return;
    }
    if (out.state === "error") {
      setCenter({ kind: "error" });
      return;
    }
    setCenter({ kind: "ready", data: out.data });
  }, [logout]);

  const loadRules = useCallback(async () => {
    const out = await fetchPushRules();
    if ("unauthorized" in out) {
      logout();
      return;
    }
    if (out.state === "error") {
      setRules({ kind: "error" });
      return;
    }
    setRules({ kind: "ready", rules: out.rules });
  }, [logout]);

  useEffect(() => {
    void loadCenter();
    void loadRules();
  }, [loadCenter, loadRules]);

  // Run a mutation, log out on a 401, and refresh both reads on success so the
  // inbox and the rules never disagree with the server after a tune or a mute.
  const run = useCallback(
    async (op: () => Promise<MutationOutcome>) => {
      setBusy(true);
      try {
        const out = await op();
        if ("unauthorized" in out) {
          logout();
          return;
        }
        await Promise.all([loadCenter(), loadRules()]);
      } finally {
        setBusy(false);
      }
    },
    [logout, loadCenter, loadRules],
  );

  const unread = center.kind === "ready" ? center.data.unreadCount : 0;

  return (
    <PageWidth space="tall">
      <PageHeader
        eyebrow="Notifications"
        title="Proactive intelligence"
        subtitle="The breaches worth your attention, ranked by the dollars at stake and the confidence behind them. A below-threshold or muted breach is still recorded here, shown distinct, so tuning the noise down never loses the signal. Every figure is computed from persisted state; a breach with no dollar prediction shows a dash, never a fabricated number."
      />

      <div className="mt-7 grid gap-8">
        <div>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <SectionHeading
              eyebrow={unread > 0 ? `${unread} unread` : "All caught up"}
              title="Notification center"
            />
            {center.kind === "ready" && unread > 0 && (
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => void run(() => markAllNotificationsRead())}
              >
                Mark all read
              </button>
            )}
          </div>
          {center.kind === "loading" && <SkeletonLines lines={6} />}
          {center.kind === "error" && (
            <ErrorState message="The notification center could not be loaded." onRetry={() => void loadCenter()} />
          )}
          {center.kind === "ready" && (
            <CenterBody
              notifications={center.data.notifications}
              busy={busy}
              onRead={(id) => void run(() => markNotificationRead(id))}
            />
          )}
        </div>

        <div>
          <SectionHeading eyebrow="Tuning" title="Rules and thresholds" />
          {rules.kind === "loading" && <SkeletonLines lines={5} />}
          {rules.kind === "error" && (
            <ErrorState message="Your rules could not be loaded." onRetry={() => void loadRules()} />
          )}
          {rules.kind === "ready" && (
            <RulesBody rules={rules.rules} busy={busy} run={run} />
          )}
        </div>
      </div>
    </PageWidth>
  );
}

function CenterBody({
  notifications,
  busy,
  onRead,
}: {
  notifications: PushNotification[];
  busy: boolean;
  onRead: (id: string) => void;
}) {
  if (notifications.length === 0) {
    return (
      <EmptyState
        title="Nothing to report"
        message="When a committed action carries material predicted value, or a measured outcome misses its prediction, it appears here ranked by the dollars at stake."
      />
    );
  }
  return (
    <div className="grid gap-3">
      {notifications.map((n) => (
        <NotificationCard key={n.id} n={n} busy={busy} onRead={onRead} />
      ))}
    </div>
  );
}

function NotificationCard({
  n,
  busy,
  onRead,
}: {
  n: PushNotification;
  busy: boolean;
  onRead: (id: string) => void;
}) {
  const status = STATUS_PILL[n.deliveryStatus];
  const suppressed = n.deliveryStatus === "suppressed";
  const unread = !n.read && !suppressed;
  return (
    <div
      className={`card p-[18px] border-l-[3px] ${suppressed ? "opacity-[0.72]" : "opacity-100"} ${unread ? "border-gold" : "border-transparent"}`}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-serif text-[16px] text-navy">
            {n.title}
          </span>
          <Pill color={status.color}>{status.label}</Pill>
          {unread && <Pill color="amber">Unread</Pill>}
        </div>
        <span className="eyebrow text-slate-light">
          {n.tenantName ?? "Unknown company"}
        </span>
      </div>

      <p className="mt-2.5 text-slate-base text-[14px] leading-normal">{n.message}</p>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-[18px] items-baseline flex-wrap">
          <Figure label="Impact" value={formatUsd(n.impactUsd)} mono accent={n.impactUsd == null ? "muted" : "coral"} />
          <Figure label="Confidence" value={n.confidence == null ? "-" : pct(n.confidence)} mono />
          <Figure label="Rank score" value={n.rankScore.toLocaleString("en-US")} mono />
          <Figure label="Channel" value={CHANNEL_LABEL[n.channel]} />
          <Figure label="Recorded" value={formatDateTime(n.createdAt)} />
        </div>
        {unread && (
          <button className="btn-ghost" disabled={busy} onClick={() => onRead(n.id)}>
            Mark read
          </button>
        )}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "coral" | "muted";
}) {
  const tone = accent === "coral" ? "text-coral-ink" : accent === "muted" ? "text-slate-light" : "text-navy";
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="eyebrow text-slate-light text-meta">
        {label}
      </span>
      <span className={`${mono ? "font-mono " : ""}text-[14px] ${tone}`}>
        {value}
      </span>
    </span>
  );
}

function RulesBody({
  rules,
  busy,
  run,
}: {
  rules: PushRule[];
  busy: boolean;
  run: (op: () => Promise<MutationOutcome>) => Promise<void>;
}) {
  if (rules.length === 0) {
    return (
      <EmptyState
        title="No rules yet"
        message="A default rule is created for each company and kind once you can see a company. There are none to tune here yet."
      />
    );
  }
  return (
    <div className="grid gap-3">
      {rules.map((r) => (
        <RuleCard key={r.id} rule={r} busy={busy} run={run} />
      ))}
    </div>
  );
}

function RuleCard({
  rule,
  busy,
  run,
}: {
  rule: PushRule;
  busy: boolean;
  run: (op: () => Promise<MutationOutcome>) => Promise<void>;
}) {
  const [impact, setImpact] = useState(rule.minImpactUsd == null ? "" : String(rule.minImpactUsd));
  const [confidence, setConfidence] = useState(rule.minConfidence == null ? "" : String(rule.minConfidence));

  const mutedActive = rule.mutedUntil != null && new Date(rule.mutedUntil).getTime() > Date.now();

  const saveThresholds = () => {
    const minImpactUsd = impact.trim() === "" ? null : Number(impact);
    const minConfidence = confidence.trim() === "" ? null : Number(confidence);
    if (minImpactUsd !== null && (!Number.isFinite(minImpactUsd) || minImpactUsd < 0)) return;
    if (
      minConfidence !== null &&
      (!Number.isInteger(minConfidence) || minConfidence < 0 || minConfidence > 100)
    ) {
      return;
    }
    void run(() => patchPushRule(rule.id, { minImpactUsd, minConfidence }));
  };

  return (
    <div className={`card p-[18px] ${rule.enabled ? "opacity-100" : "opacity-70"}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-serif text-[16px] text-navy">
            {TYPE_LABEL[rule.type]}
          </span>
          {!rule.enabled && <Pill color="gray">Disabled</Pill>}
          {mutedActive && <Pill color="amber">Muted</Pill>}
        </div>
        <span className="eyebrow text-slate-light">
          {rule.tenantName ?? "Unknown company"}
        </span>
      </div>

      {mutedActive && (
        <p className="mt-2 text-slate-light text-caption">
          Muted until {formatDateTime(rule.mutedUntil)}. Breaches are still recorded, shown suppressed.
        </p>
      )}

      <div className="mt-3.5 flex gap-4 items-end flex-wrap">
        <ThresholdInput
          label="Min impact (USD)"
          value={impact}
          placeholder="No floor"
          onChange={setImpact}
        />
        <ThresholdInput
          label="Min confidence (%)"
          value={confidence}
          placeholder="No floor"
          onChange={setConfidence}
        />
        <button className="btn-ghost" disabled={busy} onClick={saveThresholds}>
          Save thresholds
        </button>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => void run(() => patchPushRule(rule.id, { enabled: !rule.enabled }))}
          >
            {rule.enabled ? "Disable" : "Enable"}
          </button>
          {mutedActive ? (
            <button className="btn-ghost" disabled={busy} onClick={() => void run(() => mutePushRule(rule.id, 0))}>
              Unmute
            </button>
          ) : (
            <button className="btn-ghost" disabled={busy} onClick={() => void run(() => mutePushRule(rule.id, 24))}>
              Mute 24h
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ThresholdInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex flex-col gap-1">
      <span className="eyebrow text-slate-light text-meta">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-[130px] bg-cream border border-border-base rounded-md py-1.5 px-2.5 text-[14px] text-navy font-mono"
      />
    </label>
  );
}
