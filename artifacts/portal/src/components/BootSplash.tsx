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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "var(--navy-deep)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              background: "rgba(229, 201, 123, 0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShieldCheck size={17} color="var(--gold-light)" />
          </div>
          <span className="font-serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--cream-light)" }}>
            Different Day
          </span>
        </div>

        <div className="eyebrow" style={{ color: "var(--gold-light)" }}>
          {isLive ? "Generating intelligence" : "Intelligence ready"}
        </div>
        <h1 className="font-serif" style={{ fontSize: 26, fontWeight: 700, color: "var(--cream-light)", margin: "8px 0 0", lineHeight: 1.2 }}>
          {current ? current.name : "Loading"}
        </h1>

        <div style={{ marginTop: 24 }}>
          {runs === null && <Working label="Reading recorded runs" />}

          {runs !== null && isLive && (
            <div style={{ display: "grid", gap: 8 }}>
              {active.map((r) => (
                <LiveRow key={r.id} layerKey={r.layerKey} stage={currentStage(r.subStages)} />
              ))}
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
                {active.length} of {runs.length} layers still running. This view updates as they complete.
              </div>
            </div>
          )}

          {runs !== null && !isLive && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                  gap: 1,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <Stat label="Layers" value={String(runs.length)} />
                <Stat label="Stages" value={String(totalStages)} />
                <Stat label="Compute" value={formatDuration(totalMs)} />
                {errored.length > 0 && <Stat label="Errored" value={String(errored.length)} tone="coral" />}
              </div>
              {model && (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 12 }}>
                  Reasoned by {model}.
                </div>
              )}
              <button
                className="btn-primary"
                onClick={onDone}
                style={{ marginTop: 24, display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                Enter the brief <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>

        <button
          onClick={onDone}
          style={{
            marginTop: 20,
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        background: "rgba(255,255,255,0.05)",
        borderRadius: 6,
      }}
    >
      <span className="font-mono" style={{ fontSize: 13, color: "var(--cream-light)" }}>
        {layerKey}
      </span>
      <span style={{ fontSize: 12, color: "var(--gold-light)" }}>{stage ? stage.name : "finishing"}</span>
    </div>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="skeleton" style={{ height: 14, width: "70%", opacity: 0.4 }} />
      <div className="skeleton" style={{ height: 14, width: "45%", opacity: 0.4 }} />
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "coral" }) {
  return (
    <div style={{ background: "var(--navy-deep)", padding: "14px 12px" }}>
      <div
        className="font-mono"
        style={{ fontSize: 20, fontWeight: 500, color: tone === "coral" ? "var(--coral)" : "var(--cream-light)", lineHeight: 1 }}
      >
        {value}
      </div>
      <div className="eyebrow" style={{ color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
        {label}
      </div>
    </div>
  );
}
