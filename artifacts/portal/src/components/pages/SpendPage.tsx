import React, { useCallback, useEffect, useState } from "react";
import type { SpendSummary } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { fetchSpendSummary } from "../../lib/spendApi";
import {
  EmptyState,
  ErrorState,
  MetricTile,
  PageHeader,
  PageWidth,
  SectionHeading,
  SkeletonLines,
} from "../primitives";
import { formatDate, formatDateTime, formatInt } from "../primitives/format";

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: SpendSummary }
  | { kind: "error" };

// USD formatter. Per-call costs can be a fraction of a cent, so a value under a
// dollar shows four decimals; larger figures show the usual two. It never
// rounds a real cost away to zero unless it truly is zero.
function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const decimals = abs > 0 && abs < 1 ? 4 : 2;
  return (
    "$" +
    n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  );
}

// The owner-only cost and token observability console (Phase N). Every figure is
// a real model_usage ledger sum: each row there is one real model call, priced
// from its real token counts at the configured list-price rates. Nothing here is
// estimated. The four data states are honest: a shimmer while loading, a plain
// empty fact before the first seed, a loud coral error, and the real figures
// once spend exists.
export function SpendPage() {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const out = await fetchSpendSummary();
    if ("unauthorized" in out) return void logout();
    if (out.state === "error") return setState({ kind: "error" });
    setState({ kind: "ready", data: out.data });
  }, [logout]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 96 }}>
      <PageHeader
        eyebrow="Operations"
        title="Cost and token observability"
        subtitle="Real model spend, summed from the usage ledger. Each row is one real model call priced from its real token counts at the configured list-price rates. Nothing here is estimated; verify the rates against current provider pricing."
      />

      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={8} />}
        {state.kind === "error" && (
          <ErrorState message="The spend summary could not be loaded." onRetry={load} />
        )}
        {state.kind === "ready" && <SpendBody data={state.data} />}
      </div>
    </PageWidth>
  );
}

function SpendBody({ data }: { data: SpendSummary }) {
  if (data.total.calls === 0) {
    return (
      <EmptyState
        title="No model spend recorded yet"
        message="Once a tenant is seeded, every real model call is recorded here with its real token counts and list-price cost."
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <CapsPanel data={data} />
      <TotalsPanel data={data} />
      <DailyPanel data={data} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }} className="spend-cols">
        <BreakdownTable
          eyebrow="By seat"
          title="Spend by model seat"
          rows={data.bySeat.map((r) => ({ key: r.seat, label: r.seat, costUsd: r.costUsd, calls: r.calls }))}
        />
        <BreakdownTable
          eyebrow="By stage"
          title="Spend by pipeline stage"
          rows={data.byStage.map((r) => ({ key: r.stage, label: r.stage, costUsd: r.costUsd, calls: r.calls }))}
        />
      </div>
      <BreakdownTable
        eyebrow="By tenant"
        title="Spend by tenant"
        rows={data.byTenant.map((r) => ({
          key: r.tenantId ?? "deleted",
          label: r.name ?? (r.tenantId ? "Unknown tenant" : "Deleted tenant"),
          costUsd: r.costUsd,
          calls: r.calls,
        }))}
      />
      <RunsPanel data={data} />
    </div>
  );
}

// The month-to-date spend against the configured global ceiling, the one figure
// that decides whether new seeds are paused. The bar and its tone tell the truth
// at a glance: teal under the alert threshold, amber once it is crossed, coral
// once the ceiling is reached and new seeds are paused.
function CapsPanel({ data }: { data: SpendSummary }) {
  const { caps } = data;
  const cap = caps.globalMonthlyCapUsd;
  const spent = caps.globalMonthSpendUsd;
  const fraction = cap > 0 ? Math.min(spent / cap, 1) : 0;
  const tone = caps.globalOverCap ? "var(--coral)" : caps.globalOverThreshold ? "var(--amber)" : "var(--teal)";
  const thresholdPct = Math.round(caps.alertThreshold * 100);

  return (
    <div className="card">
      <SectionHeading
        eyebrow="Budget"
        title="This month against the global cap"
        action={
          <span style={{ fontSize: 13, color: "var(--slate)" }}>
            Since {formatDate(caps.monthStart)}
          </span>
        }
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="font-mono" style={{ fontSize: 28, fontWeight: 500, color: tone, lineHeight: 1 }}>
          {formatUsd(spent)}
        </span>
        <span style={{ fontSize: 15, color: "var(--slate)" }}>
          of {cap > 0 ? formatUsd(cap) : "no cap set"}
        </span>
      </div>
      {cap > 0 && (
        <div
          style={{
            marginTop: 14,
            height: 8,
            borderRadius: 4,
            background: "var(--cream-dark)",
            overflow: "hidden",
          }}
          role="img"
          aria-label={`${Math.round(fraction * 100)} percent of the global monthly cap used`}
        >
          <div style={{ width: `${fraction * 100}%`, height: "100%", background: tone }} />
        </div>
      )}
      <div style={{ marginTop: 14, fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>
        {caps.globalOverCap
          ? "The global monthly cap has been reached. New seeds are paused until next month; the owner can override a single seed, or run an express seed to spend less."
          : caps.globalOverThreshold
            ? `Spend has crossed the ${thresholdPct}% alert threshold. New seeds still run, but the cap is approaching.`
            : `Under the ${thresholdPct}% alert threshold.`}{" "}
        Per-tenant monthly cap: {caps.tenantMonthlyCapUsd > 0 ? formatUsd(caps.tenantMonthlyCapUsd) : "no cap set"}.
      </div>
    </div>
  );
}

function TotalsPanel({ data }: { data: SpendSummary }) {
  const t = data.total;
  return (
    <div>
      <SectionHeading eyebrow="All time" title="Totals across every recorded call" />
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}
      >
        <MetricTile label="Total cost" value={formatUsd(t.costUsd)} />
        <MetricTile label="Model calls" value={formatInt(t.calls)} />
        <MetricTile label="Input tokens" value={formatInt(t.inputTokens)} />
        <MetricTile label="Output tokens" value={formatInt(t.outputTokens)} />
        <MetricTile label="Cache read tokens" value={formatInt(t.cacheReadTokens)} />
        <MetricTile label="Cache write tokens" value={formatInt(t.cacheCreationTokens)} />
        <MetricTile label="Web searches" value={formatInt(t.webSearchCalls)} />
      </div>
    </div>
  );
}

// A hand-drawn daily bar chart over the trailing 30 days, no charting
// dependency. A day with no spend has no bar (the ledger has no row), so a gap
// is an honest gap rather than an invented zero point.
function DailyPanel({ data }: { data: SpendSummary }) {
  const days = data.daily;
  if (days.length === 0) {
    return (
      <div>
        <SectionHeading eyebrow="Last 30 days" title="Daily spend" />
        <EmptyState title="No spend in the last 30 days" />
      </div>
    );
  }
  const max = Math.max(...days.map((d) => d.costUsd), 0) || 1;
  return (
    <div>
      <SectionHeading eyebrow="Last 30 days" title="Daily spend" />
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
          {days.map((d) => {
            const h = Math.max((d.costUsd / max) * 100, d.costUsd > 0 ? 3 : 0);
            return (
              <div
                key={d.day}
                title={`${formatDate(d.day)}: ${formatUsd(d.costUsd)}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: `${h}%`,
                  background: "var(--navy)",
                  borderRadius: "2px 2px 0 0",
                  opacity: 0.85,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12, color: "var(--slate-light)" }}>
          <span>{formatDate(days[0].day)}</span>
          <span>{formatDate(days[days.length - 1].day)}</span>
        </div>
      </div>
    </div>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  costUsd: number;
  calls: number;
}

function BreakdownTable({
  eyebrow,
  title,
  rows,
}: {
  eyebrow: string;
  title: string;
  rows: BreakdownRow[];
}) {
  return (
    <div>
      <SectionHeading eyebrow={eyebrow} title={title} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <Th align="left">Name</Th>
                <Th align="right">Calls</Th>
                <Th align="right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderTop: "1px solid var(--cream-dark)" }}>
                  <Td>
                    <span style={{ color: "var(--navy)", fontWeight: 500 }}>{r.label}</span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--slate)" }}>{formatInt(r.calls)}</span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--navy)" }}>{formatUsd(r.costUsd)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RunsPanel({ data }: { data: SpendSummary }) {
  const rows = data.byRun;
  return (
    <div>
      <SectionHeading eyebrow="Recent" title="Most recent layer runs" />
      {rows.length === 0 ? (
        <EmptyState title="No layer runs recorded yet" />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <Th align="left">Tenant</Th>
                <Th align="left">Layer</Th>
                <Th align="left">When</Th>
                <Th align="right">Calls</Th>
                <Th align="right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.runId ?? r.at} style={{ borderTop: "1px solid var(--cream-dark)" }}>
                  <Td>
                    <span style={{ color: "var(--navy)", fontWeight: 500 }}>
                      {r.tenantName ?? (r.tenantId ? "Unknown tenant" : "Deleted tenant")}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono" style={{ color: "var(--slate)" }}>{r.layerKey ?? "-"}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--slate)" }}>{formatDateTime(r.at)}</span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--slate)" }}>{formatInt(r.calls)}</span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--navy)" }}>{formatUsd(r.costUsd)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="eyebrow"
      style={{ textAlign: align, padding: "12px 16px", color: "var(--slate-light)", fontWeight: 600 }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td style={{ textAlign: align, padding: "12px 16px" }}>{children}</td>;
}
