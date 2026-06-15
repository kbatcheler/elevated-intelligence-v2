import React, { useCallback, useEffect, useState } from "react";
import type { GapSeverity, PortfolioPattern, PortfolioSummary, PortfolioTenant } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { useRouter } from "../../lib/router";
import { fetchPortfolioSummary } from "../../lib/portfolioApi";
import {
  EmptyState,
  ErrorState,
  MetricTile,
  PageHeader,
  PageWidth,
  Pill,
  SectionHeading,
  SkeletonLines,
} from "../primitives";
import { formatInt, formatUsd, pct } from "../primitives/format";

// The Portfolio Intelligence board (Phase Y). The whole surface is a state
// machine over one read: loading, an access state for a non-portfolio seat
// (the server returns 403, mirrored as its own honest panel), an error with a
// retry, or the ranked board. Every figure is rendered straight from the server
// response, which computes it from persisted state; where a company has no
// numeric prediction the value is null and shows a plain dash, never a fabricated
// zero or a fabricated "value at risk".
type State =
  | { kind: "loading" }
  | { kind: "ready"; data: PortfolioSummary }
  | { kind: "forbidden" }
  | { kind: "error" };

const SEVERITY_COLOR: Record<GapSeverity, "coral" | "amber" | "gray"> = {
  high: "coral",
  medium: "amber",
  low: "gray",
};

export function PortfolioPage() {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const out = await fetchPortfolioSummary();
    if ("unauthorized" in out) {
      logout();
      return;
    }
    if ("forbidden" in out) {
      setState({ kind: "forbidden" });
      return;
    }
    if (out.state === "error") {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "ready", data: out.data });
  }, [logout]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 96 }}>
      <PageHeader
        eyebrow="Portfolio"
        title="Portfolio intelligence"
        subtitle="Every company you hold on one board, ranked by the value still on the table. Identified value is the sum of committed predictions, realized is the sum of measured outcomes, and the difference is what is unrealized. A company with no numeric prediction shows a dash, never a fabricated figure."
      />
      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={8} />}
        {state.kind === "forbidden" && (
          <EmptyState
            title="Portfolio view is for portfolio accounts"
            message="This board ranks the companies a portfolio holds. Your account is not part of a portfolio org, so there is nothing to rank here."
          />
        )}
        {state.kind === "error" && (
          <ErrorState message="The portfolio summary could not be loaded." onRetry={() => void load()} />
        )}
        {state.kind === "ready" && <PortfolioBody data={state.data} />}
      </div>
    </PageWidth>
  );
}

function PortfolioBody({ data }: { data: PortfolioSummary }) {
  if (data.tenants.length === 0) {
    return (
      <EmptyState
        title="No companies in this portfolio yet"
        message="Once a company is bound to this portfolio, it appears here ranked against the rest."
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 32 }}>
      <TotalsPanel data={data} />
      <PatternsPanel patterns={data.patterns} />
      <RankedPanel tenants={data.tenants} />
    </div>
  );
}

function TotalsPanel({ data }: { data: PortfolioSummary }) {
  const t = data.totals;
  return (
    <div>
      <SectionHeading
        eyebrow={data.scope.type === "provider" ? "All companies" : data.scope.orgName ?? "Portfolio"}
        title="Across the portfolio"
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 }}>
        <MetricTile label="Companies" value={formatInt(t.tenantCount)} />
        <MetricTile label="Value on the table" value={formatUsd(t.unrealizedValueUsd)} tone="warn" />
        <MetricTile label="Value identified" value={formatUsd(t.valueIdentifiedUsd)} />
        <MetricTile label="Value realized" value={formatUsd(t.valueRealizedUsd)} tone="good" />
        <MetricTile
          label="Open gaps"
          value={formatInt(t.openGaps.total)}
          sub={`${t.openGaps.high} high / ${t.openGaps.medium} med / ${t.openGaps.low} low`}
        />
        <MetricTile label="With diagnosis" value={`${t.tenantsWithLayerContent} of ${t.tenantCount}`} />
      </div>
    </div>
  );
}

function PatternsPanel({ patterns }: { patterns: PortfolioPattern[] }) {
  return (
    <div>
      <SectionHeading eyebrow="Cross-portfolio" title="Gap patterns across companies" />
      {patterns.length === 0 ? (
        <EmptyState
          title="No shared gap patterns yet"
          message="A pattern appears once two or more companies share the same gap in the same layer. With fewer companies or no overlap, each company's gaps live in its own diagnosis."
        />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {patterns.map((p) => (
            <div key={`${p.layerKey}:${p.kind ?? "UNKNOWN"}`} className="card" style={{ padding: 18 }}>
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
                  <span className="font-serif" style={{ fontSize: 17, color: "var(--navy)" }}>
                    {p.affectedTenants} of {p.totalTenants} companies
                  </span>
                  <Pill color={SEVERITY_COLOR[p.severity]}>{p.severity}</Pill>
                  {p.kind && <Pill color="navy">{p.kind}</Pill>}
                </div>
                <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
                  {p.layerName}
                </span>
              </div>
              {p.examples.length > 0 && (
                <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--slate)", fontSize: 14, lineHeight: 1.5 }}>
                  {p.examples.map((ex, i) => (
                    <li key={i}>{ex}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RankedPanel({ tenants }: { tenants: PortfolioTenant[] }) {
  const { setCurrentId } = useTenant();
  const { navigate } = useRouter();
  const open = (tenantId: string) => {
    setCurrentId(tenantId);
    navigate("/");
  };
  return (
    <div>
      <SectionHeading eyebrow="Ranked" title="Companies by value on the table" />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th align="right">#</Th>
              <Th align="left">Company</Th>
              <Th align="right">On the table</Th>
              <Th align="right">Identified</Th>
              <Th align="right">Realized</Th>
              <Th align="right">Confidence</Th>
              <Th align="left">Open gaps</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.tenantId} style={{ borderTop: "1px solid var(--cream-dark)" }}>
                <Td align="right">
                  <span className="font-mono" style={{ color: "var(--slate-light)" }}>
                    {t.rank}
                  </span>
                </Td>
                <Td>
                  <span style={{ color: "var(--navy)", fontWeight: 600 }}>{t.tenantName}</span>
                  <div style={{ fontSize: 12, color: "var(--slate-light)", marginTop: 2 }}>
                    {t.generatedLayers} of {t.totalLayers} layers
                    {t.completeness.missing.length > 0 &&
                      ` - missing ${t.completeness.missing.map(labelMissing).join(", ")}`}
                  </div>
                </Td>
                <Td align="right">
                  <span
                    className="font-mono"
                    style={{ color: t.unrealizedValueUsd == null ? "var(--slate-light)" : "var(--coral)" }}
                  >
                    {formatUsd(t.unrealizedValueUsd)}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-mono" style={{ color: "var(--navy)" }}>
                    {formatUsd(t.valueIdentifiedUsd)}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-mono" style={{ color: "var(--teal)" }}>
                    {formatUsd(t.valueRealizedUsd)}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-mono" style={{ color: "var(--slate)" }}>
                    {t.overallConfidence == null ? "-" : pct(t.overallConfidence)}
                  </span>
                </Td>
                <Td>
                  {t.openGaps.total === 0 ? (
                    <span style={{ color: "var(--slate-light)" }}>none</span>
                  ) : (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="font-mono" style={{ color: "var(--navy)" }}>
                        {t.openGaps.total}
                      </span>
                      {t.openGaps.high > 0 && <Pill color="coral">{t.openGaps.high} high</Pill>}
                      {t.openGaps.medium > 0 && <Pill color="amber">{t.openGaps.medium} med</Pill>}
                      {t.openGaps.low > 0 && <Pill color="gray">{t.openGaps.low} low</Pill>}
                    </span>
                  )}
                </Td>
                <Td align="right">
                  <button className="btn-ghost" onClick={() => open(t.tenantId)}>
                    View diagnosis
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function labelMissing(key: string): string {
  if (key === "layer_content") return "diagnosis";
  if (key === "outcomes") return "outcomes";
  return key;
}

function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
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
