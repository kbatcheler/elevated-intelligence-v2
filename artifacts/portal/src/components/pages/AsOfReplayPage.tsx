import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AsOfLayerView, Basis, TenantAsOf } from "../../types";
import { fetchTenantAsOf } from "../../lib/replayApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { Link } from "../../lib/router";
import {
  ConfidencePill,
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  Pill,
  SkeletonLines,
  formatDateTime,
} from "../primitives";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: TenantAsOf }
  | { kind: "bad-date" }
  | { kind: "no-tenant" }
  | { kind: "error" };

// Format a Date as the value an <input type="datetime-local"> expects (local
// wall-clock, minute precision). Used only to seed and bind the picker.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultPick(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return toLocalInput(d);
}

// The as-of replay surface (Phase AM). Pick a past instant and see what the
// system believed THEN, layer by layer, with the confidence and data-efficacy it
// had earned by then, beside an honest diff of what has changed since. Every
// figure is reconstructed read-only from the append-only snapshot ledger and
// timestamped state; this view exports history, it can never edit it.
export function AsOfReplayPage() {
  const { logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [pick, setPick] = useState<string>(defaultPick);
  const [state, setState] = useState<State>({ kind: "idle" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (atLocal: string) => {
      if (!currentId) return;
      if (!atLocal) {
        setState({ kind: "bad-date" });
        return;
      }
      const parsed = new Date(atLocal);
      if (Number.isNaN(parsed.getTime())) {
        setState({ kind: "bad-date" });
        return;
      }
      setState({ kind: "loading" });
      const out = await fetchTenantAsOf(currentId, parsed.toISOString());
      if (!mounted.current) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "ready") setState({ kind: "ready", data: out.data });
      else if (out.state === "bad-date") setState({ kind: "bad-date" });
      else setState({ kind: "error" });
    },
    [currentId, logout],
  );

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    void run(pick);
    // Re-run only when the tenant changes; the picker re-runs on submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, tenantStatus]);

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Replay"
        title="As-of replay"
        subtitle={
          current
            ? `Reconstruct what the system believed about ${current.name} at any past instant, with the confidence and data-efficacy it had then, beside what has changed since. Read only; history is never edited.`
            : undefined
        }
      />

      <div className="card" style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
            As of
          </span>
          <input
            type="datetime-local"
            value={pick}
            max={toLocalInput(new Date())}
            onChange={(e) => setPick(e.target.value)}
            style={{
              background: "var(--cream)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 14,
              color: "var(--navy)",
              fontFamily: "var(--font-serif)",
            }}
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void run(pick)}
          disabled={!currentId || state.kind === "loading"}
          style={{ fontSize: 13 }}
        >
          {state.kind === "loading" ? "Replaying..." : "Replay this date"}
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The as-of view could not be reconstructed." onRetry={() => void run(pick)} />
        )}
        {state.kind === "bad-date" && (
          <EmptyState
            title="Pick a date to replay"
            message="Choose a past instant above. The replay reconstructs the diagnosis as it stood at that moment."
          />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its history can be replayed here."
          />
        )}
        {state.kind === "ready" && <ReplayView data={state.data} />}
      </div>
    </PageWidth>
  );
}

function ReplayView({ data }: { data: TenantAsOf }) {
  if (!data.hasHistory) {
    return (
      <EmptyState
        title="No snapshot at that date"
        message={
          data.earliestSnapshotAt
            ? `No layer had been built for ${data.tenantName} by ${formatDateTime(data.asOf)}. The earliest snapshot on record is ${formatDateTime(data.earliestSnapshotAt)}. Pick a later date to replay a real build.`
            : `No snapshots are on record for ${data.tenantName} yet. Once a diagnosis is built, its history can be replayed here.`
        }
      />
    );
  }
  const ledgerGrowth = data.ledger.entriesCurrent - data.ledger.entriesAsOf;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <Figure label="As of" value={formatDateTime(data.asOf)} sub={`Compared against now (${formatDateTime(data.now)})`} />
          <Figure
            label="Evidence ledger"
            value={String(data.ledger.entriesAsOf)}
            sub={ledgerGrowth > 0 ? `+${ledgerGrowth} entries since` : "no growth since"}
            color="var(--navy)"
          />
          <Figure label="Decisions since" value={String(data.decisionsSince)} sub="board decisions recorded after this date" />
          <Figure label="Outcomes since" value={String(data.outcomesSince)} sub="graded measurements after this date" />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Pill color={data.dataMode === "connected" ? "teal" : "amber"}>
            {data.dataMode === "connected" ? "Connector-grounded" : "Outside-in"}
          </Pill>
          {data.earliestSnapshotAt && (
            <span style={{ fontSize: 12, color: "var(--slate-light)" }}>
              Snapshots on record: {formatDateTime(data.earliestSnapshotAt)} to {formatDateTime(data.latestSnapshotAt ?? data.earliestSnapshotAt)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {data.layers.map((l) => (
          <LayerCard key={l.layerKey} layer={l} />
        ))}
      </div>
    </div>
  );
}

function Figure({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: "var(--slate-light)" }}>
        {label}
      </div>
      <div className="font-serif" style={{ fontSize: 22, color: color ?? "var(--navy)" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--slate-light)" }}>{sub}</div>
    </div>
  );
}

function basisOf(reduced: boolean | null): Basis {
  // A reduced (express) build rested on a thinner read; treat its claims as
  // modelled. A full build is shown on the verified basis pill background. This
  // mirrors the live layer page's honest basis labelling.
  return reduced ? "modelled" : "verified";
}

function LayerCard({ layer }: { layer: AsOfLayerView }) {
  if (!layer.available) {
    return (
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span className="font-serif" style={{ fontSize: 16, color: "var(--navy)" }}>
            {layer.layerName}
          </span>
          <span style={{ fontSize: 12, color: "var(--slate-light)" }}>{layer.layerKey}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Pill color="gray">No build by this date</Pill>
          {layer.changedSince.hasCurrent && <Pill color="navy">Built since</Pill>}
        </div>
      </div>
    );
  }

  const eff = layer.efficacy;
  const conf = layer.confidence;
  const d = layer.changedSince;
  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Link to={`/layers/${layer.layerKey}`} className="font-serif" style={{ fontSize: 16, color: "var(--navy)", textDecoration: "none" }}>
          {layer.layerName}
        </Link>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {layer.reducedMode && <Pill color="amber">Express build</Pill>}
          {eff && <Pill color="navy">Efficacy {eff.score}</Pill>}
          {conf && (
            <span>
              <ConfidencePill basis={basisOf(layer.reducedMode)} confidence={conf.adjusted} />
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--slate-light)" }}>
        {layer.snapshotAt && <span>Built {formatDateTime(layer.snapshotAt)}</span>}
        {layer.generatorModel && <span className="font-mono">{layer.generatorModel}</span>}
        <span>Verified claims: {countItems(layer.verifiedClaims)}</span>
        <span>Modelled claims: {countItems(layer.modelledClaims)}</span>
        <span>Confounders: {Array.isArray(layer.confounders) ? layer.confounders.length : 0}</span>
      </div>

      <ChangedSinceRow diff={d} />
    </div>
  );
}

function countItems(claims: Record<string, unknown> | null): number {
  const items = (claims as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.filter((x) => x != null && typeof x === "object").length : 0;
}

// The honest "what changed since" row. A delta is shown only when both sides
// carried the figure; otherwise the row says the comparison is unavailable
// rather than implying a move from or to zero.
function ChangedSinceRow({ diff }: { diff: AsOfLayerView["changedSince"] }) {
  if (!diff.hasCurrent) {
    return (
      <div style={{ borderTop: "1px solid var(--cream-dark)", paddingTop: 8, fontSize: 12, color: "var(--slate-light)" }}>
        No current build to compare against; this layer has not been rebuilt since.
      </div>
    );
  }
  return (
    <div style={{ borderTop: "1px solid var(--cream-dark)", paddingTop: 8, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
      <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
        Changed since
      </span>
      <Pill color={diff.contentChanged ? "amber" : "teal"}>
        {diff.contentChanged ? "Diagnosis revised" : "Diagnosis unchanged"}
      </Pill>
      <Delta label="Efficacy" value={diff.efficacyDelta} places={1} />
      <Delta label="Confidence" value={diff.confidenceDelta} places={2} />
      <Delta label="Verified" value={diff.verifiedDelta} places={0} />
      <Delta label="Modelled" value={diff.modelledDelta} places={0} />
      <Delta label="Confounders" value={diff.confounderDelta} places={0} />
    </div>
  );
}

function Delta({ label, value, places }: { label: string; value: number | null; places: number }) {
  if (value === null) {
    return (
      <span style={{ color: "var(--slate-light)" }}>
        {label}: <span title="The figure was not available on both sides">unavailable</span>
      </span>
    );
  }
  const sign = value > 0 ? "+" : "";
  const color = value > 0 ? "var(--teal-ink)" : value < 0 ? "var(--coral-ink)" : "var(--slate-light)";
  return (
    <span style={{ color: "var(--slate)" }}>
      {label}: <span style={{ color, fontWeight: 600 }}>{sign}{value.toFixed(places)}</span>
    </span>
  );
}
