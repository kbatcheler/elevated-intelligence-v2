import React, { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { PipelineRun, SubStage } from "../types";
import { fetchRuns } from "../lib/tenantApi";
import { useAuth } from "../lib/AuthContext";
import { useTenant } from "../lib/TenantContext";
import { formatDuration } from "./primitives";

// The boot splash. It reads the tenant's real recorded pipeline runs. If a run
// is genuinely in flight (queued or running) it polls and shows the live
// sub-stage state; once nothing is in flight it shows a static recap of the
// recorded run, never replaying a finished run as if it were live. When there is
// no tenant or no run telemetry to show, it steps aside immediately so the app
// renders its own designed states.
export function BootSplash({ onDone }: { onDone: () => void }) {
  const { logout } = useAuth();
  const { current, currentId, status: tenantStatus } = useTenant();
  const [runs, setRuns] = useState<PipelineRun[] | null>(null);

  // No tenant resolved: wait while loading, otherwise step aside.
  useEffect(() => {
    if (currentId || tenantStatus === "loading") return;
    onDone();
  }, [currentId, tenantStatus, onDone]);

  useEffect(() => {
    if (!currentId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const out = await fetchRuns(currentId);
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "error" || out.state === "empty") return void onDone();
      setRuns(out.items);
      const live = out.items.some((r) => r.status === "queued" || r.status === "running");
      if (live) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [currentId, logout, onDone]);

  const active = runs ? runs.filter((r) => r.status === "queued" || r.status === "running") : [];
  const isLive = active.length > 0;
  const errored = runs ? runs.filter((r) => r.status === "error") : [];
  const totalStages = runs ? runs.reduce((s, r) => s + r.subStages.length, 0) : 0;
  const totalMs = runs
    ? runs.reduce((s, r) => s + r.subStages.reduce((a, x) => a + (x.durationMs ?? 0), 0), 0)
    : 0;
  const model = runs?.flatMap((r) => r.subStages).map((s) => s.telemetry?.model).find(Boolean);

  return (
    <div className="fixed inset-0 z-50 bg-navy-deep flex items-center justify-center p-6">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-[34px] h-[34px] rounded-[17px] bg-[rgba(229,201,123,0.14)] flex items-center justify-center">
            <ShieldCheck size={17} color="var(--gold-light)" />
          </div>
          <span className="font-serif text-title font-bold text-cream-light">
            Different Day
          </span>
        </div>

        <div className="eyebrow text-gold-light">
          {isLive ? "Generating intelligence" : "Intelligence ready"}
        </div>
        <h1 className="font-serif text-[26px] font-bold text-cream-light mt-2 leading-[1.2]">
          {current ? current.name : "Loading"}
        </h1>

        <div className="mt-6">
          {runs === null && <Working label="Reading recorded runs" />}

          {runs !== null && isLive && (
            <div className="grid gap-2">
              {active.map((r) => (
                <LiveRow key={r.id} layerKey={r.layerKey} stage={currentStage(r.subStages)} />
              ))}
              <div className="text-xs text-white/55 mt-1">
                {active.length} of {runs.length} layers still running. This view updates as they complete.
              </div>
            </div>
          )}

          {runs !== null && !isLive && (
            <>
              <div className="grid gap-px [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))] bg-white/[0.08] border border-white/[0.08] rounded-lg overflow-hidden">
                <Stat label="Layers" value={String(runs.length)} />
                <Stat label="Stages" value={String(totalStages)} />
                <Stat label="Compute" value={formatDuration(totalMs)} />
                {errored.length > 0 && <Stat label="Errored" value={String(errored.length)} tone="coral" />}
              </div>
              {model && (
                <div className="text-xs text-white/55 mt-3">
                  Reasoned by {model}.
                </div>
              )}
              <button
                className="btn-primary mt-6 gap-2"
                onClick={onDone}
              >
                Enter the brief <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>

        <button
          onClick={onDone}
          className="mt-5 bg-transparent border-none text-white/50 text-xs cursor-pointer p-0"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// The stage a live run is presently working: the running one, else the next
// pending one. Returns null when every stage already resolved.
function currentStage(stages: SubStage[]): SubStage | null {
  return stages.find((s) => s.status === "running") ?? stages.find((s) => s.status === "pending") ?? null;
}

function LiveRow({ layerKey, stage }: { layerKey: string; stage: SubStage | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3.5 bg-white/5 rounded-md">
      <span className="font-mono text-caption text-cream-light">
        {layerKey}
      </span>
      <span className="text-xs text-gold-light">{stage ? stage.name : "finishing"}</span>
    </div>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div className="grid gap-2">
      <div className="skeleton opacity-40" style={{ height: 14, width: "70%" }} />
      <div className="skeleton opacity-40" style={{ height: 14, width: "45%" }} />
      <div className="text-xs text-white/55 mt-1">{label}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "coral" }) {
  return (
    <div className="bg-navy-deep py-3.5 px-3">
      <div
        className={`font-mono text-title font-medium leading-none ${
          tone === "coral" ? "text-coral" : "text-cream-light"
        }`}
      >
        {value}
      </div>
      <div className="eyebrow text-white/50 mt-1.5">
        {label}
      </div>
    </div>
  );
}
