import React, { useEffect, useState } from "react";
import { Cpu, Globe, Anchor } from "lucide-react";
import type { Architecture, PipelineRun } from "../../types";
import { fetchArchitecture, fetchRuns } from "../../lib/tenantApi";
import { aggregateBySeat, type SeatAgg } from "../../lib/reasoningTelemetry";
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
    <PageWidth space="page">
      <PageHeader
        eyebrow="Intelligence"
        title="Intelligence architecture"
        subtitle={
          state.kind === "ready"
            ? `The fixed reasoning engine behind every layer: ${Object.keys(state.arch.seats).length} seats across ${state.arch.stages.length} stages.`
            : "The fixed reasoning engine behind every layer."
        }
      />
      <div className="mt-7">
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
    <div className="grid gap-10">
      <section>
        <SectionHeading eyebrow="Seats" title="Who does the reasoning" />
        <TelemetryNote hasTenant={hasTenant} hasRuns={runs.length > 0} runsError={runsError} tenantName={tenantName} />
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] mt-4">
          {seats.map(([name, seat]) => (
            <SeatCard key={name} name={name} provider={seat.provider} model={seat.model} agg={agg.get(name) ?? null} />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Pipeline" title="The reasoning stages, in order" />
        <div className="grid gap-2">
          {arch.stages.map((stage, i) => (
            <div
              key={`${stage.name}-${i}`}
              className="card flex items-center gap-4 py-3.5 px-[18px] flex-wrap"
            >
              <span className="font-mono text-caption text-slate-light w-6 shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex-[1_1_220px] min-w-0">
                <div className="font-serif text-[16px] text-navy">
                  {stage.name}
                </div>
                <div className="text-caption text-slate-base leading-snug mt-0.5">{stage.role}</div>
              </div>
              <div className="flex flex-col gap-1.5 items-end min-w-0">
                <span className={`pill pill-navy`}>{stage.seat}</span>
                <span className="font-mono text-xs text-slate-light">
                  {stage.provider} / {stage.model}
                </span>
              </div>
              <div className="flex gap-2 shrink-0">
                {stage.webSearch && (
                  <span className="pill pill-blue inline-flex gap-1 items-center">
                    <Globe size={11} /> Web search
                  </span>
                )}
                {stage.grounding && (
                  <span className="pill pill-teal inline-flex gap-1 items-center">
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
      <div className="text-caption text-coral-ink mt-0.5">
        Per-seat telemetry is temporarily unavailable; the architecture below is still accurate.
      </div>
    );
  }
  if (!hasTenant) {
    return (
      <div className="text-caption text-slate-light mt-0.5">
        Per-seat telemetry appears once a tenant is selected and its runs are recorded.
      </div>
    );
  }
  if (!hasRuns) {
    return (
      <div className="text-caption text-slate-light mt-0.5">
        No reasoning runs recorded yet{tenantName ? ` for ${tenantName}` : ""}, so seats show no telemetry.
      </div>
    );
  }
  return (
    <div className="text-caption text-slate-light mt-0.5">
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
    <div className="card grid gap-3">
      <div className="flex items-center gap-2.5">
        <div className="w-[30px] h-[30px] rounded-lg bg-cream flex items-center justify-center shrink-0">
          <Cpu size={15} color="var(--navy-soft)" />
        </div>
        <div className="min-w-0">
          <div className="font-serif text-lead text-navy">
            {name}
          </div>
          <div className="font-mono text-xs text-slate-light">
            {provider} / {model}
          </div>
        </div>
      </div>
      {agg ? (
        <div className="grid grid-cols-[1fr_1fr] gap-y-2 gap-x-3">
          <Stat label="Stages run" value={formatInt(agg.stages)} />
          <Stat label="Compute" value={formatDuration(agg.durationMs)} />
          <Stat label="Tokens in" value={formatInt(agg.inputTokens)} />
          <Stat label="Tokens out" value={formatInt(agg.outputTokens)} />
          {agg.searchCalls > 0 && <Stat label="Search calls" value={formatInt(agg.searchCalls)} />}
        </div>
      ) : (
        <div className="text-[12.5px] text-slate-light">No recorded telemetry for this seat.</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[16px] font-medium text-navy leading-[1.1]">
        {value}
      </div>
      <div className="eyebrow text-slate-light mt-[3px]">
        {label}
      </div>
    </div>
  );
}
