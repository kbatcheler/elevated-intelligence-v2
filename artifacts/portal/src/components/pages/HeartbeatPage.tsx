import React, { useEffect, useState } from "react";
import { Activity, Search, Clock, Layers as LayersIcon } from "lucide-react";
import type { PipelineRun, SignalLayer } from "../../types";
import { fetchRuns, fetchSignals } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { deriveHeartbeat, type FeedPulse } from "../../lib/heartbeat";
import { Link } from "../../lib/router";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  SkeletonLines,
  formatDateTime,
  formatDuration,
  formatInt,
} from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; signals: SignalLayer[]; runs: PipelineRun[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

const POLL_MS = 1500;

// The data heartbeat. Each feed and the layers that consume it are registry
// facts, so they appear for every tenant; the pulse beside each feed is the real
// run telemetry the pipeline recorded (last finished run, recorded search calls,
// recorded stage durations). When a run is genuinely in flight it polls and the
// pulse updates; once nothing is live it rests on the recorded totals, never
// animating a finished run as if it were still running.
export function HeartbeatPage() {
  const { logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ kind: "loading" });

    // Initial load reads both feeds and runs; the poll re-reads only runs (the
    // sole thing that changes mid-flight) and keeps the registry-derived feeds.
    let signals: SignalLayer[] = [];
    const poll = async () => {
      const runsOut = await fetchRuns(currentId);
      if (!alive) return;
      if ("unauthorized" in runsOut) return void logout();
      if (runsOut.state === "error") {
        // Transient failure: keep the last good render and retry rather than
        // freezing the poll with a stale "Updating live" pill.
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      setState({ kind: "ready", signals, runs: runsOut.items });
      if (runsOut.items.some((r) => r.status === "queued" || r.status === "running")) {
        timer = setTimeout(poll, POLL_MS);
      }
    };

    Promise.all([fetchSignals(currentId), fetchRuns(currentId)]).then(([sigOut, runsOut]) => {
      if (!alive) return;
      if ("unauthorized" in sigOut || "unauthorized" in runsOut) return void logout();
      if (sigOut.state === "error" || runsOut.state === "error") return setState({ kind: "error" });
      if (sigOut.state === "empty") return setState({ kind: "empty" });
      signals = sigOut.items;
      setState({ kind: "ready", signals, runs: runsOut.items });
      if (runsOut.items.some((r) => r.status === "queued" || r.status === "running")) {
        timer = setTimeout(poll, POLL_MS);
      }
    });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [currentId, tenantStatus, logout]);

  const pulses = state.kind === "ready" ? deriveHeartbeat(state.signals, state.runs) : [];
  const live = state.kind === "ready" && state.runs.some((r) => r.status === "queued" || r.status === "running");

  return (
    <PageWidth space="page">
      <PageHeader
        eyebrow="Data heartbeat"
        title="Feeds and how alive they are"
        subtitle={current ? `The data feeds ${current.name}'s intelligence reads, and the real activity recorded against each.` : undefined}
        actions={
          state.kind === "ready" ? (
            <span
              className={`pill inline-flex items-center gap-1.5 ${live ? "bg-blue-faint text-blue-base" : "bg-cream-dark text-slate-base"}`}
            >
              <Activity size={12} /> {live ? "Updating live" : "At rest"}
            </span>
          ) : undefined
        }
      />
      <div className="mt-7">
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The data heartbeat could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its feeds will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState title="No feeds to show" message="No layers are registered for this tenant, so there are no feeds to track." />
        )}
        {state.kind === "ready" && pulses.length === 0 && (
          <EmptyState title="No feeds declared" message="No layer in the registry declares a data feed." />
        )}
        {state.kind === "ready" && pulses.length > 0 && (
          <div className="grid gap-3">
            {pulses.map((p) => (
              <PulseRow key={p.feed} pulse={p} />
            ))}
          </div>
        )}
      </div>
    </PageWidth>
  );
}

function PulseRow({ pulse }: { pulse: FeedPulse }) {
  const alive = pulse.lastFinishedAt != null;
  return (
    <div className="card grid gap-3">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span
          className={`w-2 h-2 rounded shrink-0 ${alive ? "bg-teal" : "bg-slate-light"}`}
        />
        <span className="font-mono text-[14px] text-navy">
          {pulse.feed}
        </span>
        <span className="eyebrow text-slate-light ml-auto">
          {alive ? `Last active ${formatDateTime(pulse.lastFinishedAt)}` : "Not run yet"}
        </span>
      </div>

      <div className="flex flex-wrap gap-y-1.5 gap-x-2 items-center">
        <span className="eyebrow text-slate-light">Consumed by</span>
        {pulse.consumingLayers.map((l) => (
          <Link key={l.key} to={`/layers/${l.key}`} className="pill pill-navy no-underline">
            {l.name}
          </Link>
        ))}
      </div>

      <div className="flex gap-[18px] flex-wrap text-[12.5px] text-slate-base">
        <span className="inline-flex items-center gap-[5px]">
          <LayersIcon size={13} color="var(--slate-light)" /> {formatInt(pulse.runCount)} runs
        </span>
        <span className="inline-flex items-center gap-[5px]">
          <Search size={13} color="var(--slate-light)" /> {formatInt(pulse.searchCalls)} search calls
        </span>
        <span className="inline-flex items-center gap-[5px]">
          <Clock size={13} color="var(--slate-light)" /> {formatDuration(pulse.totalDurationMs)} compute
        </span>
      </div>
    </div>
  );
}
