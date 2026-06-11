import React, { useEffect, useState } from "react";
import { Cpu, Globe, Anchor } from "lucide-react";
import type { Architecture, PipelineRun } from "../../types";
import { fetchArchitecture, fetchRuns } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  SectionHeading,
  SkeletonLines,
  formatDuration,
  formatInt,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; arch: Architecture; runs: PipelineRun[]; hasTenant: boolean; runsError: boolean }
  | { kind: "empty" }
  | { kind: "error" };

interface SeatAgg {
  stages: number;
  inputTokens: number;
  outputTokens: number;
  searchCalls: number;
  durationMs: number;
}

// Sum the per-seat telemetry the pipeline actually recorded. Nothing here is
// computed beyond adding up values the runs persisted; a seat with no recorded
// stages simply has no aggregate, which is honest rather than invented.
function aggregateBySeat(runs: readonly PipelineRun[]): Map<string, SeatAgg> {
  const m = new Map<string, SeatAgg>();
  for (const r of runs) {
    for (const s of r.subStages) {
      const seat = s.telemetry?.seat;
      if (!seat) continue;
      const cur = m.get(seat) ?? { stages: 0, inputTokens: 0, outputTokens: 0, searchCalls: 0, durationMs: 0 };
      cur.stages += 1;
      cur.inputTokens += s.telemetry?.inputTokens ?? 0;
      cur.outputTokens += s.telemetry?.outputTokens ?? 0;
      cur.searchCalls += s.telemetry?.searchCalls ?? 0;
      cur.durationMs += s.durationMs ?? 0;
      m.set(seat, cur);
    }
  }
  return m;
}

// The Intelligence Architecture. The reasoning engine is fixed engine config
// (seats and an ordered set of stages), identical for every tenant and read
// from GET /api/architecture, so the portal never hardcodes a model string. The
// current tenant's recorded runs decorate each seat with the real telemetry the
// pipeline produced. With no tenant selected the architecture still stands on
// its own; telemetry simply waits for a tenant's runs.
export function ReasoningPage() {
  const { logout } = useAuth();
  const { currentId, current } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    Promise.all([
      fetchArchitecture(),
      currentId ? fetchRuns(currentId) : Promise.resolve(null),
    ]).then(([archOut, runsOut]) => {
      if (!alive) return;
      if ("unauthorized" in archOut) return void logout();
      if (runsOut && "unauthorized" in runsOut) return void logout();
      if (archOut.state === "empty") return setState({ kind: "empty" });
      if (archOut.state === "error") return setState({ kind: "error" });
      let runs: PipelineRun[] = [];
      let runsError = false;
      if (runsOut && !("unauthorized" in runsOut)) {
        if (runsOut.state === "error") runsError = true;
        else runs = runsOut.items;
      }
      setState({ kind: "ready", arch: archOut.data, runs, hasTenant: Boolean(currentId), runsError });
    });
    return () => {
      alive = false;
    };
  }, [currentId, logout]);

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Intelligence"
        title="Intelligence architecture"
        subtitle={
          state.kind === "ready"
            ? `The fixed reasoning engine behind every layer: ${Object.keys(state.arch.seats).length} seats across ${state.arch.stages.length} stages.`
            : "The fixed reasoning engine behind every layer."
        }
      />
      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The intelligence architecture could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "empty" && (
          <EmptyState
            title="No architecture configured"
            message="The reasoning engine has not been configured yet."
          />
        )}
        {state.kind === "ready" && (
          <Architecture
            arch={state.arch}
            runs={state.runs}
            hasTenant={state.hasTenant}
            runsError={state.runsError}
            tenantName={current?.name ?? null}
          />
        )}
      </div>
    </PageWidth>
  );
}

function Architecture({
  arch,
  runs,
  hasTenant,
  runsError,
  tenantName,
}: {
  arch: Architecture;
  runs: PipelineRun[];
  hasTenant: boolean;
  runsError: boolean;
  tenantName: string | null;
}) {
  const agg = aggregateBySeat(runs);
  const seats = Object.entries(arch.seats);

  return (
    <div style={{ display: "grid", gap: 40 }}>
      <section>
        <SectionHeading eyebrow="Seats" title="Who does the reasoning" />
        <TelemetryNote hasTenant={hasTenant} hasRuns={runs.length > 0} runsError={runsError} tenantName={tenantName} />
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            marginTop: 16,
          }}
        >
          {seats.map(([name, seat]) => (
            <SeatCard key={name} name={name} provider={seat.provider} model={seat.model} agg={agg.get(name) ?? null} />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Pipeline" title="The reasoning stages, in order" />
        <div style={{ display: "grid", gap: 8 }}>
          {arch.stages.map((stage, i) => (
            <div
              key={`${stage.name}-${i}`}
              className="card"
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", flexWrap: "wrap" }}
            >
              <span className="font-mono" style={{ fontSize: 13, color: "var(--slate-light)", width: 24, flexShrink: 0 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div className="font-serif" style={{ fontSize: 16, color: "var(--navy)" }}>
                  {stage.name}
                </div>
                <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.4, marginTop: 2 }}>{stage.role}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", minWidth: 0 }}>
                <span className={`pill pill-navy`}>{stage.seat}</span>
                <span className="font-mono" style={{ fontSize: 12, color: "var(--slate-light)" }}>
                  {stage.provider} / {stage.model}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {stage.webSearch && (
                  <span className="pill pill-blue" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <Globe size={11} /> Web search
                  </span>
                )}
                {stage.grounding && (
                  <span className="pill pill-teal" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <Anchor size={11} /> Grounded
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TelemetryNote({
  hasTenant,
  hasRuns,
  runsError,
  tenantName,
}: {
  hasTenant: boolean;
  hasRuns: boolean;
  runsError: boolean;
  tenantName: string | null;
}) {
  if (runsError) {
    return (
      <div style={{ fontSize: 13, color: "var(--coral)", marginTop: 2 }}>
        Per-seat telemetry is temporarily unavailable; the architecture below is still accurate.
      </div>
    );
  }
  if (!hasTenant) {
    return (
      <div style={{ fontSize: 13, color: "var(--slate-light)", marginTop: 2 }}>
        Per-seat telemetry appears once a tenant is selected and its runs are recorded.
      </div>
    );
  }
  if (!hasRuns) {
    return (
      <div style={{ fontSize: 13, color: "var(--slate-light)", marginTop: 2 }}>
        No reasoning runs recorded yet{tenantName ? ` for ${tenantName}` : ""}, so seats show no telemetry.
      </div>
    );
  }
  return (
    <div style={{ fontSize: 13, color: "var(--slate-light)", marginTop: 2 }}>
      Telemetry below is the real recorded total across {tenantName ?? "this tenant"}'s runs.
    </div>
  );
}

function SeatCard({
  name,
  provider,
  model,
  agg,
}: {
  name: string;
  provider: string;
  model: string;
  agg: SeatAgg | null;
}) {
  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "var(--cream)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Cpu size={15} color="var(--navy-soft)" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="font-serif" style={{ fontSize: 17, color: "var(--navy)" }}>
            {name}
          </div>
          <div className="font-mono" style={{ fontSize: 12, color: "var(--slate-light)" }}>
            {provider} / {model}
          </div>
        </div>
      </div>
      {agg ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
          <Stat label="Stages run" value={formatInt(agg.stages)} />
          <Stat label="Compute" value={formatDuration(agg.durationMs)} />
          <Stat label="Tokens in" value={formatInt(agg.inputTokens)} />
          <Stat label="Tokens out" value={formatInt(agg.outputTokens)} />
          {agg.searchCalls > 0 && <Stat label="Search calls" value={formatInt(agg.searchCalls)} />}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--slate-light)" }}>No recorded telemetry for this seat.</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 16, fontWeight: 500, color: "var(--navy)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="eyebrow" style={{ color: "var(--slate-light)", marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}
