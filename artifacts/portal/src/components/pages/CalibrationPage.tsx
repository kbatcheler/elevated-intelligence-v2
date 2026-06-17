import React, { useCallback, useEffect, useState } from "react";
import type {
  CalibrationBand,
  CalibrationLedgerRow,
  CalibrationSegment,
  CalibrationSummary,
} from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { fetchCalibrationSummary } from "../../lib/calibrationApi";
import {
  EmptyState,
  ErrorState,
  MetricTile,
  PageHeader,
  PageWidth,
  SectionHeading,
  SkeletonLines,
} from "../primitives";
import { formatBrier, formatDate, formatDateTime, formatInt, formatRatioPct } from "../primitives/format";
import {
  calibrationHeadline,
  curveRadius,
  curveScale,
  isOnDiagonal,
  maxBandN,
} from "../../lib/calibrationView";

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: CalibrationSummary }
  | { kind: "error" };

// The owner-only Brier-scored calibration ledger (Phase AJ). Every figure is a
// real computation over resolved forecasts: a probability the real Evaluator
// stated, resolved only from a persisted measurement or an owner adjudication.
// The four data states are honest: a shimmer while loading, a plain empty fact
// before the first resolution, a loud coral error, and the real figures once a
// forecast has resolved. A thin sample carries an honest label, and the ledger
// always includes misses.
export function CalibrationPage() {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const out = await fetchCalibrationSummary();
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
        title="Calibration ledger"
        subtitle="How well the system's stated probabilities have matched reality, scored with the Brier rule. Every figure is computed from forecasts the Evaluator made and that a real measurement or an owner adjudication later resolved. Misses are always included; a thin sample is labelled as such, never dressed up as a track record."
      />

      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={8} />}
        {state.kind === "error" && (
          <ErrorState message="The calibration summary could not be loaded." onRetry={load} />
        )}
        {state.kind === "ready" && <CalibrationBody data={state.data} />}
      </div>
    </PageWidth>
  );
}

function CalibrationBody({ data }: { data: CalibrationSummary }) {
  if (data.resolvedCount === 0) {
    return (
      <EmptyState
        title="No forecasts have resolved yet"
        message={
          data.openCount > 0
            ? formatInt(data.openCount) +
              " forecast(s) are open, waiting on a measurement or an owner adjudication. The Brier score appears once the first one resolves."
            : "Once the Evaluator makes a forecast and a real measurement or an owner adjudication resolves it, its Brier score is recorded here."
        }
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <HeadlinePanel data={data} />
      <CurvePanel curve={data.curve} />
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 28 }}
        className="calibration-cols"
      >
        <SegmentTable eyebrow="By layer" title="Brier by layer" rows={data.byLayer} keyLabel="Layer" />
        <SegmentTable eyebrow="By kind" title="Brier by forecast kind" rows={data.byKind} keyLabel="Kind" />
        <SegmentTable eyebrow="By seat" title="Brier by subject seat" rows={data.bySeat} keyLabel="Seat" />
      </div>
      <LedgerPanel rows={data.ledger} />
    </div>
  );
}

// The headline Brier against the fixed 0.25 coin-flip baseline, with a
// plain-English reading. The verdict is only stated once the sample is
// established; below the threshold the honest "early, n resolved" label leads so
// a lucky handful of resolutions never reads as a proven track record.
function HeadlinePanel({ data }: { data: CalibrationSummary }) {
  const { headline, baseline, resolvedCount, openCount } = data;
  const established = headline.label.established;
  const { tone, reading } = calibrationHeadline(data);

  return (
    <div className="card">
      <SectionHeading
        eyebrow="Headline"
        title="Mean Brier score"
        action={
          <span style={{ fontSize: 13, color: "var(--slate)" }}>
            {established ? "Established" : headline.label.label}
          </span>
        }
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          className="font-mono"
          style={{ fontSize: 32, fontWeight: 500, color: tone, lineHeight: 1 }}
        >
          {formatBrier(headline.meanBrier)}
        </span>
        <span style={{ fontSize: 15, color: "var(--slate)" }}>
          vs {baseline.toFixed(2)} coin-flip baseline
        </span>
      </div>
      <div style={{ marginTop: 14, fontSize: 13, color: "var(--slate)", lineHeight: 1.5 }}>
        {reading} Lower is better: 0 is a perfect forecaster, 1 is perfectly wrong.
      </div>
      <div
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 16,
        }}
      >
        <MetricTile label="Resolved forecasts" value={formatInt(resolvedCount)} />
        <MetricTile label="Open forecasts" value={formatInt(openCount)} />
        <MetricTile label="Established at" value={formatInt(data.threshold) + " resolved"} />
      </div>
    </div>
  );
}

// The reliability curve, hand-drawn as an SVG with no charting dependency. The
// x-axis is the stated-probability band; the y-axis the observed frequency. A
// well-calibrated system sits on the dashed diagonal (forecasts it calls 70
// percent come true about 70 percent of the time). An empty band has no point
// (its statistics are null), so a gap is an honest gap, never a plotted zero.
function CurvePanel({ curve }: { curve: CalibrationBand[] }) {
  const plotted = curve.filter(
    (b) => b.avgProbability !== null && b.observedFrequency !== null && b.n > 0,
  );

  return (
    <div>
      <SectionHeading eyebrow="Reliability" title="Calibration curve" />
      {plotted.length === 0 ? (
        <EmptyState
          title="No bands to plot yet"
          message="The curve fills in as forecasts across the probability range resolve. The dashed diagonal is perfect calibration."
        />
      ) : (
        <div className="card" style={{ padding: 20 }}>
          <CurveSvg curve={curve} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 10,
              fontSize: 12,
              color: "var(--slate-light)",
            }}
          >
            <span>Stated probability, left to right 0 to 100%</span>
            <span>Dot size scales with resolved count</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CurveSvg({ curve }: { curve: CalibrationBand[] }) {
  const size = 280;
  const pad = 28;
  const { inner, x, y } = curveScale(size, pad);
  const maxN = maxBandN(curve);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      style={{ maxWidth: 360, display: "block", margin: "0 auto" }}
      role="img"
      aria-label="Calibration curve: stated probability against observed frequency, with a perfect-calibration diagonal"
    >
      <rect x={pad} y={pad} width={inner} height={inner} fill="none" stroke="var(--cream-dark)" />
      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(1)}
        y2={y(1)}
        stroke="var(--slate-light)"
        strokeDasharray="4 4"
      />
      {curve.map((b) => {
        if (b.avgProbability === null || b.observedFrequency === null || b.n === 0) return null;
        const r = curveRadius(b.n, maxN);
        const onDiagonal = isOnDiagonal(b.avgProbability, b.observedFrequency);
        return (
          <circle
            key={b.lower}
            cx={x(b.avgProbability)}
            cy={y(b.observedFrequency)}
            r={r}
            fill={onDiagonal ? "var(--teal)" : "var(--amber)"}
            opacity={0.85}
          >
            <title>
              {`Stated ${Math.round(b.avgProbability * 100)}%, observed ${Math.round(
                b.observedFrequency * 100,
              )}% (${b.n} resolved)`}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function SegmentTable({
  eyebrow,
  title,
  rows,
  keyLabel,
}: {
  eyebrow: string;
  title: string;
  rows: CalibrationSegment[];
  keyLabel: string;
}) {
  return (
    <div>
      <SectionHeading eyebrow={eyebrow} title={title} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing resolved yet" />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <Th align="left">{keyLabel}</Th>
                <Th align="right">n</Th>
                <Th align="right">Brier</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderTop: "1px solid var(--cream-dark)" }}>
                  <Td>
                    <span style={{ color: "var(--navy)", fontWeight: 500 }}>{r.key}</span>
                    {!r.label.established && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: "var(--slate-light)" }}>
                        {r.label.label}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--slate)" }}>
                      {formatInt(r.n)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--navy)" }}>
                      {formatBrier(r.meanBrier)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The resolved-forecast ledger. It always includes misses (outcome 0): this is a
// track record, not a highlight reel. Each row shows the stated probability, the
// realised outcome, the per-forecast Brier, and how it was resolved.
function LedgerPanel({ rows }: { rows: CalibrationLedgerRow[] }) {
  return (
    <div>
      <SectionHeading
        eyebrow="Track record"
        title="Resolved forecasts"
        action={
          <span style={{ fontSize: 13, color: "var(--slate)" }}>Misses included</span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No forecasts have resolved yet" />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <Th align="left">Forecast</Th>
                <Th align="left">Layer</Th>
                <Th align="right">Stated</Th>
                <Th align="left">Outcome</Th>
                <Th align="right">Brier</Th>
                <Th align="left">Basis</Th>
                <Th align="left">Resolved</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--cream-dark)" }}>
                  <Td>
                    <span style={{ color: "var(--navy)", fontWeight: 500 }}>{r.statement}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--slate-light)" }}>
                      {r.kind} | {r.subjectSeat}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono" style={{ color: "var(--slate)" }}>
                      {r.layerKey}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--slate)" }}>
                      {formatRatioPct(r.probability)}
                    </span>
                  </Td>
                  <Td>
                    <OutcomePill outcome={r.outcome} />
                  </Td>
                  <Td align="right">
                    <span className="font-mono" style={{ color: "var(--navy)" }}>
                      {formatBrier(r.brierScore)}
                    </span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--slate)" }}>{r.resolutionBasis ?? "-"}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--slate)" }}>{formatDateTime(r.resolvedAt)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OutcomePill({ outcome }: { outcome: number }) {
  const hit = outcome === 1;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: hit ? "var(--teal-deep, var(--teal))" : "var(--coral)",
        background: hit ? "var(--teal-faint, var(--cream-dark))" : "var(--coral-faint, var(--cream-dark))",
        border: "1px solid " + (hit ? "var(--teal)" : "var(--coral)"),
      }}
    >
      {hit ? "Realized" : "Missed"}
    </span>
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
  return <td style={{ textAlign: align, padding: "12px 16px", verticalAlign: "top" }}>{children}</td>;
}
