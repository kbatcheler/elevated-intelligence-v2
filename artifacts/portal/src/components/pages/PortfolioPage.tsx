import React, { useCallback, useEffect, useState } from "react";
import type { PortfolioPattern, PortfolioSummary, PortfolioTenant } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { useRouter } from "../../lib/router";
import { fetchPortfolioSummary } from "../../lib/portfolioApi";
import { SEVERITY_COLOR, labelMissing } from "../../lib/portfolioView";
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
    <PageWidth space="tall">
      <PageHeader
        eyebrow="Portfolio"
        title="Portfolio intelligence"
        subtitle="Every company you hold on one board, ranked by the value still on the table. Identified value is the sum of committed predictions, realised is the sum of measured outcomes, and the difference is what is unrealised. A company with no numeric prediction shows a dash, never a fabricated figure."
      />
      <div className="mt-7">
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
    <div className="grid gap-8">
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
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))] gap-4">
        <MetricTile label="Companies" value={formatInt(t.tenantCount)} />
        <MetricTile label="Value on the table" value={formatUsd(t.unrealizedValueUsd)} tone="warn" />
        <MetricTile label="Value identified" value={formatUsd(t.valueIdentifiedUsd)} />
        <MetricTile label="Value realised" value={formatUsd(t.valueRealizedUsd)} tone="good" />
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
        <div className="grid gap-3">
          {patterns.map((p) => (
            <div key={`${p.layerKey}:${p.kind ?? "UNKNOWN"}`} className="card p-[18px]">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-serif text-lead text-navy">
                    {p.affectedTenants} of {p.totalTenants} companies
                  </span>
                  <Pill color={SEVERITY_COLOR[p.severity]}>{p.severity}</Pill>
                  {p.kind && <Pill color="navy">{p.kind}</Pill>}
                </div>
                <span className="eyebrow text-slate-light">
                  {p.layerName}
                </span>
              </div>
              {p.examples.length > 0 && (
                <ul className="mt-3 pl-[18px] text-slate-base text-[14px] leading-normal">
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
      <div className="card p-0 overflow-hidden">
        <div className="table-scroll">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border-base">
              <Th align="right">#</Th>
              <Th align="left">Company</Th>
              <Th align="right">On the table</Th>
              <Th align="right">Identified</Th>
              <Th align="right">Realised</Th>
              <Th align="right">Confidence</Th>
              <Th align="right">Data efficacy</Th>
              <Th align="left">Open gaps</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.tenantId} className="border-t border-cream-dark">
                <Td align="right">
                  <span className="font-mono text-slate-light">
                    {t.rank}
                  </span>
                </Td>
                <Td>
                  <span className="text-navy font-semibold">{t.tenantName}</span>
                  <div className="text-xs text-slate-light mt-0.5">
                    {t.generatedLayers} of {t.totalLayers} layers
                    {t.completeness.missing.length > 0 &&
                      ` - missing ${t.completeness.missing.map(labelMissing).join(", ")}`}
                  </div>
                </Td>
                <Td align="right">
                  <span
                    className={`font-mono ${t.unrealizedValueUsd == null ? "text-slate-light" : "text-coral-ink"}`}
                  >
                    {formatUsd(t.unrealizedValueUsd)}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-mono text-navy">
                    {formatUsd(t.valueIdentifiedUsd)}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-mono text-teal-ink">
                    {formatUsd(t.valueRealizedUsd)}
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-mono text-slate-base">
                    {t.overallConfidence == null ? "-" : pct(t.overallConfidence)}
                  </span>
                </Td>
                <Td align="right">
                  {t.efficacyScore == null ? (
                    <span className="font-mono text-slate-light">
                      -
                    </span>
                  ) : (
                    <span
                      title={`Data efficacy ${t.efficacyScore} of 100 across ${t.efficacyLayers} generated layer(s); #${t.efficacyRank} by data quality in this portfolio.`}
                      className="inline-flex gap-1.5 items-baseline"
                    >
                      <span className="font-mono text-navy font-semibold">
                        {t.efficacyScore}
                      </span>
                      <span className="text-xs text-slate-light">
                        #{t.efficacyRank}
                      </span>
                    </span>
                  )}
                </Td>
                <Td>
                  {t.openGaps.total === 0 ? (
                    <span className="text-slate-light">none</span>
                  ) : (
                    <span className="inline-flex gap-1.5 items-center flex-wrap">
                      <span className="font-mono text-navy">
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
    </div>
  );
}

function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`eyebrow py-3 px-4 text-slate-light font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={`py-3 px-4 ${align === "right" ? "text-right" : "text-left"}`}>{children}</td>;
}
