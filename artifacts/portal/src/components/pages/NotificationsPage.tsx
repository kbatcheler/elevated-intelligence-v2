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
    <PageWidth style={{ paddingTop: 28, paddingBottom: 96 }}>
      <PageHeader
        eyebrow="Notifications"
        title="Proactive intelligence"
        subtitle="The breaches worth your attention, ranked by the dollars at stake and the confidence behind them. A below-threshold or muted breach is still recorded here, shown distinct, so tuning the noise down never loses the signal. Every figure is computed from persisted state; a breach with no dollar prediction shows a dash, never a fabricated number."
      />

      <div style={{ marginTop: 28, display: "grid", gap: 32 }}>
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
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
    <div style={{ display: "grid", gap: 12 }}>
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
      className="card"
      style={{
        padding: 18,
        opacity: suppressed ? 0.72 : 1,
        borderLeft: unread ? "3px solid var(--gold)" : "3px solid transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span className="font-serif" style={{ fontSize: 16, color: "var(--navy)" }}>
            {n.title}
          </span>
          <Pill color={status.color}>{status.label}</Pill>
          {unread && <Pill color="amber">Unread</Pill>}
        </div>
        <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
          {n.tenantName ?? "Unknown company"}
        </span>
      </div>

      <p style={{ margin: "10px 0 0", color: "var(--slate)", fontSize: 14, lineHeight: 1.5 }}>{n.message}</p>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 18, alignItems: "baseline", flexWrap: "wrap" }}>
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
  const color = accent === "coral" ? "var(--coral)" : accent === "muted" ? "var(--slate-light)" : "var(--navy)";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 11 }}>
        {label}
      </span>
      <span className={mono ? "font-mono" : undefined} style={{ color, fontSize: 14 }}>
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
    <div style={{ display: "grid", gap: 12 }}>
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
    <div className="card" style={{ padding: 18, opacity: rule.enabled ? 1 : 0.7 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span className="font-serif" style={{ fontSize: 16, color: "var(--navy)" }}>
            {TYPE_LABEL[rule.type]}
          </span>
          {!rule.enabled && <Pill color="gray">Disabled</Pill>}
          {mutedActive && <Pill color="amber">Muted</Pill>}
        </div>
        <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
          {rule.tenantName ?? "Unknown company"}
        </span>
      </div>

      {mutedActive && (
        <p style={{ margin: "8px 0 0", color: "var(--slate-light)", fontSize: 13 }}>
          Muted until {formatDateTime(rule.mutedUntil)}. Breaches are still recorded, shown suppressed.
        </p>
      )}

      <div
        style={{
          marginTop: 14,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
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
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
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
    <label style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span className="eyebrow" style={{ color: "var(--slate-light)", fontSize: 11 }}>
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 130,
          background: "var(--cream)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 14,
          color: "var(--navy)",
          fontFamily: "var(--font-mono)",
        }}
      />
    </label>
  );
}
