// Phase AM diligence pack. A single, self-contained, brand-styled HTML document
// that assembles a tenant's whole evidentiary record for an outside reader (an
// acquirer, a board, an auditor): the current 14-layer diagnosis, the data
// efficacy and calibration record, the board-grade decision audit timeline, the
// outcome track record (value identified versus value realized), and a
// provenance integrity attestation.
//
// Every figure is read from persisted state through the same services the live
// surfaces use, so the pack can never drift from the app and never fabricates a
// number. The honesty boundary is carried THROUGH to the page: verified counts
// sit beside modelled counts, a confidence pill shows raw beside the disciplined
// value and whether the discipline was applied, a calibration headline carries
// its sample label, and the integrity banner states plainly whether the
// hash-chained ledger verified. It is an export, not an editor: it reads history,
// it never writes it. Zero new dependencies: the HTML is built by hand and the
// only runtime cost is string assembly over already-loaded data.

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, forecastsTable, tenantLayersTable, tenantsTable } from "@workspace/db";
import {
  aggregateBrier,
  labelSample,
  NAIVE_BASELINE,
  type ResolvedForecastPoint,
} from "../calibration/brierMath";
import { calibrationConfig } from "../calibration/config";
import { computeLayerConfidenceAdvisory } from "../calibration/layerConfidence";
import { loadTenantEfficacy } from "../efficacy/efficacyService";
import type { DataMode } from "../efficacy/efficacyMath";
import { getDecisionTimeline, type DecisionTimeline } from "../decisions/timeline";
import { verifyChain } from "../provenance/ledger";

const BRAND_PRODUCT = "Different Day";
const BRAND_POWERED_BY = "Powered by Elevated Intelligence";

function asDataMode(v: unknown): DataMode {
  return v === "outside_in" ? "outside_in" : "connected";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Pull the first non-empty string field from a content blob, used for a layer's
// one-line headline. Returns null (an honest blank) when none is present rather
// than inventing a summary.
function pickString(obj: unknown, keys: string[]): string | null {
  if (obj === null || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function countItems(claims: unknown): number {
  const items = (claims as { items?: unknown } | null)?.items;
  return Array.isArray(items)
    ? items.filter((x) => x != null && typeof x === "object").length
    : 0;
}

export interface DiligencePackLayer {
  layerKey: string;
  layerName: string;
  generated: boolean;
  reducedMode: boolean | null;
  generatedAt: string | null;
  headline: string | null;
  verifiedCount: number;
  modelledCount: number;
  efficacyScore: number | null;
  confidenceRaw: number | null;
  confidenceAdjusted: number | null;
  confidenceApplied: boolean;
  confidenceLabel: string | null;
}

export interface DiligencePackData {
  brand: { product: string; poweredBy: string };
  tenant: { id: string; name: string; dataMode: DataMode };
  generatedAt: string;
  provenance: { ok: boolean; length: number; brokenAt: number | null; detail: string | null };
  efficacy: { rollupScore: number | null; rollupN: number; modeCeiling: number; dataMode: DataMode };
  calibration: {
    meanBrier: number | null;
    n: number;
    label: string;
    beatsBaseline: boolean | null;
    baseline: number;
    openCount: number;
  };
  layers: DiligencePackLayer[];
  decisions: DecisionTimeline;
  outcomes: {
    totalIdentifiedValueUsd: number;
    totalRealizedValueUsd: number;
    commits: number;
    overruledRight: number;
    overruledWrong: number;
    overruledPending: number;
  };
}

// Assemble the whole pack for a tenant, or null when the tenant does not exist.
// now is injectable so a test can pin the generated-at stamp.
export async function buildDiligencePack(
  tenantId: string,
  now: Date = new Date(),
): Promise<DiligencePackData | null> {
  const [tenant] = await db
    .select({ name: tenantsTable.name, dataMode: tenantsTable.dataMode })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (!tenant) return null;
  const dataMode = asDataMode(tenant.dataMode);

  const [efficacy, timeline, chain] = await Promise.all([
    loadTenantEfficacy(tenantId),
    getDecisionTimeline(tenantId),
    verifyChain(tenantId),
  ]);

  // The current per-layer diagnosis content, indexed by layer.
  const layerRows = await db
    .select({
      layerKey: tenantLayersTable.layerKey,
      content: tenantLayersTable.content,
      verifiedClaims: tenantLayersTable.verifiedClaims,
      modelledClaims: tenantLayersTable.modelledClaims,
      reducedMode: tenantLayersTable.reducedMode,
      generatedAt: tenantLayersTable.generatedAt,
    })
    .from(tenantLayersTable)
    .where(eq(tenantLayersTable.tenantId, tenantId));
  const layerByKey = new Map(layerRows.map((r) => [r.layerKey, r]));

  // The tenant Brier headline, computed from resolved forecasts the same way the
  // calibration surface computes it.
  const { minResolvedPerSegment: threshold } = calibrationConfig();
  const resolvedRows = await db
    .select({
      layerKey: forecastsTable.layerKey,
      kind: forecastsTable.kind,
      subjectSeat: forecastsTable.subjectSeat,
      probability: forecastsTable.probability,
      outcome: forecastsTable.outcome,
    })
    .from(forecastsTable)
    .where(and(eq(forecastsTable.tenantId, tenantId), isNotNull(forecastsTable.resolvedAt)));
  const points: ResolvedForecastPoint[] = resolvedRows
    .filter((r) => r.outcome === 0 || r.outcome === 1)
    .map((r) => ({
      probability: num(r.probability),
      outcome: r.outcome as 0 | 1,
      layerKey: r.layerKey,
      kind: r.kind,
      subjectSeat: r.subjectSeat,
    }));
  const headlineAgg = aggregateBrier(points);
  const openRows = await db
    .select({ id: forecastsTable.id })
    .from(forecastsTable)
    .where(and(eq(forecastsTable.tenantId, tenantId), isNull(forecastsTable.resolvedAt)));

  // Layer rows driven off the efficacy rollup (registry order, every layer), each
  // joined to its current content and a per-layer confidence advisory.
  const layers: DiligencePackLayer[] = [];
  for (const le of efficacy?.layers ?? []) {
    const row = layerByKey.get(le.layerKey);
    const content = row?.content ?? null;
    const rawConfidence =
      content !== null &&
      typeof content === "object" &&
      typeof (content as { confidence?: unknown }).confidence === "number"
        ? (content as { confidence: number }).confidence
        : null;
    const advisory =
      rawConfidence === null
        ? null
        : await computeLayerConfidenceAdvisory(tenantId, le.layerKey, rawConfidence);
    layers.push({
      layerKey: le.layerKey,
      layerName: le.layerName,
      generated: le.generated,
      reducedMode: row ? row.reducedMode : null,
      generatedAt: row?.generatedAt ? row.generatedAt.toISOString() : null,
      headline: pickString(content, ["headline", "summary", "thesis", "title", "verdict"]),
      verifiedCount: countItems(row?.verifiedClaims),
      modelledCount: countItems(row?.modelledClaims),
      efficacyScore: le.index ? le.index.score : null,
      confidenceRaw: advisory ? advisory.raw : rawConfidence,
      confidenceAdjusted: advisory ? advisory.adjusted : null,
      confidenceApplied: advisory ? advisory.applied : false,
      confidenceLabel: advisory ? advisory.label.label : null,
    });
  }

  return {
    brand: { product: BRAND_PRODUCT, poweredBy: BRAND_POWERED_BY },
    tenant: { id: tenantId, name: tenant.name, dataMode },
    generatedAt: now.toISOString(),
    provenance: {
      ok: chain.ok,
      length: chain.length,
      brokenAt: chain.brokenAt ?? null,
      detail: chain.detail ?? null,
    },
    efficacy: {
      rollupScore: efficacy?.rollup.score ?? null,
      rollupN: efficacy?.rollup.n ?? 0,
      modeCeiling: efficacy?.modeCeiling ?? 0,
      dataMode,
    },
    calibration: {
      meanBrier: headlineAgg.meanBrier,
      n: headlineAgg.n,
      label: labelSample(headlineAgg.n, threshold).label,
      beatsBaseline: headlineAgg.meanBrier === null ? null : headlineAgg.meanBrier < NAIVE_BASELINE,
      baseline: NAIVE_BASELINE,
      openCount: openRows.length,
    },
    layers,
    decisions: timeline,
    outcomes: {
      totalIdentifiedValueUsd: timeline.summary.totalIdentifiedValueUsd,
      totalRealizedValueUsd: timeline.summary.totalRealizedValueUsd,
      commits: timeline.summary.commits,
      overruledRight: timeline.summary.overruledRight,
      overruledWrong: timeline.summary.overruledWrong,
      overruledPending: timeline.summary.overruledPending,
    },
  };
}

// ── HTML rendering (hand-built, no template engine, no new dependency) ───────

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function pct(n: number | null): string {
  return n === null ? "n/a" : Math.round(n) + "%";
}

function score(n: number | null): string {
  return n === null ? "n/a" : String(n);
}

function isoDate(iso: string | null): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "n/a" : d.toISOString().slice(0, 10);
}

function brierText(n: number | null): string {
  return n === null ? "n/a" : n.toFixed(3);
}

// The brand palette mirrors the portal tokens (cream paper, navy ink, gold
// accent, semantic teal/coral/amber) so the exported document reads as the same
// product. Inlined because the pack is a standalone file with no stylesheet host.
const STYLES = `
  :root {
    --cream: #F4F1EA; --cream-light: #FAF8F2; --paper: #FFFFFF; --border: #E5E2D8;
    --navy: #1B2A4E; --navy-deep: #0F1A33; --navy-soft: #4A5878;
    --gold: #C8A24A; --gold-ink: #826930; --ink: #1F1F1F; --slate: #3F4858; --slate-light: #666D7A;
    --teal: #1D9E75; --teal-ink: #177B5B; --teal-faint: #E1F5EE;
    --coral: #D85A30; --coral-ink: #B04927; --coral-faint: #FBE8DF;
    --amber-ink: #975F13; --amber-faint: #FAEEDA; --red: #A32D2D; --red-faint: #FCEBEB;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--cream); color: var(--ink);
    font-family: Georgia, "Times New Roman", serif; line-height: 1.5; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 48px 40px 80px; }
  header.cover { border-bottom: 3px solid var(--navy); padding-bottom: 24px; margin-bottom: 8px; }
  .eyebrow { font-family: Arial, Helvetica, sans-serif; text-transform: uppercase;
    letter-spacing: 0.18em; font-size: 11px; color: var(--gold-ink); font-weight: 700; }
  h1 { font-size: 30px; margin: 8px 0 4px; color: var(--navy-deep); }
  h2 { font-size: 19px; margin: 40px 0 12px; color: var(--navy); border-bottom: 1px solid var(--border);
    padding-bottom: 6px; }
  .sub { color: var(--slate-light); font-size: 14px; }
  .meta { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: var(--slate); margin-top: 10px; }
  .note { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: var(--slate-light);
    background: var(--cream-light); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px 14px; margin: 16px 0; }
  .banner { border-radius: 8px; padding: 14px 18px; margin: 16px 0; font-family: Arial, Helvetica, sans-serif;
    font-size: 13px; font-weight: 600; }
  .banner.ok { background: var(--teal-faint); color: var(--teal-ink); border: 1px solid var(--teal); }
  .banner.bad { background: var(--red-faint); color: var(--red); border: 1px solid var(--red); }
  .cards { display: flex; flex-wrap: wrap; gap: 14px; margin: 12px 0; }
  .card { flex: 1 1 200px; background: var(--paper); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px 18px; }
  .card .k { font-family: Arial, Helvetica, sans-serif; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--slate-light); }
  .card .v { font-size: 26px; color: var(--navy-deep); margin-top: 4px; }
  .card .d { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: var(--slate); margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 4px; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-family: Arial, Helvetica, sans-serif; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--slate-light); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 700;
    padding: 2px 8px; border-radius: 10px; }
  .pill.v { background: var(--teal-faint); color: var(--teal-ink); }
  .pill.m { background: var(--amber-faint); color: var(--amber-ink); }
  .pill.muted { background: var(--cream-dark, #E8E2D2); color: var(--slate); }
  .pill.warn { background: var(--coral-faint); color: var(--coral-ink); }
  .decision { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin: 10px 0;
    background: var(--paper); }
  .decision h3 { margin: 0 0 4px; font-size: 15px; color: var(--navy); }
  .decision .line { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: var(--slate); margin: 2px 0; }
  .decision .rationale { font-style: italic; color: var(--slate); margin-top: 6px; }
  .pm { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: var(--slate);
    background: var(--cream-light); border-left: 3px solid var(--gold); padding: 6px 10px; margin-top: 6px; }
  footer { margin-top: 48px; border-top: 1px solid var(--border); padding-top: 14px;
    font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: var(--slate-light); }
`;

function renderLayerRows(layers: DiligencePackLayer[]): string {
  if (layers.length === 0) {
    return `<tr><td colspan="5" class="sub">No layers generated for this tenant yet.</td></tr>`;
  }
  return layers
    .map((l) => {
      if (!l.generated) {
        return `<tr><td><strong>${esc(l.layerName)}</strong><div class="sub">${esc(l.layerKey)}</div></td>
          <td colspan="4" class="sub">Not generated yet.</td></tr>`;
      }
      const conf =
        l.confidenceRaw === null
          ? "n/a"
          : l.confidenceApplied
            ? `${pct(l.confidenceRaw)} raw, ${pct(l.confidenceAdjusted)} disciplined`
            : `${pct(l.confidenceRaw)}`;
      const label = l.confidenceLabel ? `<div class="sub">${esc(l.confidenceLabel)}</div>` : "";
      const reduced = l.reducedMode ? ` <span class="pill muted">express</span>` : "";
      const headline = l.headline ? `<div class="sub">${esc(l.headline)}</div>` : "";
      return `<tr>
        <td><strong>${esc(l.layerName)}</strong>${reduced}${headline}</td>
        <td class="num">${score(l.efficacyScore)}</td>
        <td>${conf}${label}</td>
        <td><span class="pill v">${l.verifiedCount} verified</span></td>
        <td><span class="pill m">${l.modelledCount} modelled</span></td>
      </tr>`;
    })
    .join("\n");
}

// deriveOverruledStatus (timeline) returns "right" | "wrong" | "pending" for a
// decision that CONTRADICTED the recommendation, and null for one that followed
// it. The pill renders only for the contradicting case, so null yields no pill.
function overruledPill(status: string | null): string {
  if (status === "right") return `<span class="pill warn">overruled and right</span>`;
  if (status === "wrong") return `<span class="pill v">overruled and wrong</span>`;
  if (status === "pending") return `<span class="pill muted">overruled, pending</span>`;
  return "";
}

function renderDecisions(timeline: DecisionTimeline): string {
  if (timeline.entries.length === 0) {
    return `<p class="sub">No board decisions recorded for this tenant yet.</p>`;
  }
  return timeline.entries
    .map((e) => {
      const advice = `${esc(e.recommendedTitle)} (${pct(Math.round(e.systemConfidence * 100))} confidence, basis ${esc(e.systemBasis)})`;
      const verified = e.recommendationVerified
        ? `<span class="pill v">system-verified</span>`
        : `<span class="pill muted">operator-entered</span>`;
      const outcome =
        e.realizedValueUsd !== null
          ? `realized ${money(e.realizedValueUsd)} (${esc(e.measurementStatus ?? "n/a")})`
          : e.recommendedValueUsd !== null
            ? `identified ${money(e.recommendedValueUsd)}, not yet realized`
            : "no dollar value attached";
      const pms = e.preMortems
        .map((pm) => {
          const top = pm.failureModes[0];
          const triggered = pm.indicators.filter((i) => i.status === "triggered").length;
          const head = top ? esc(top.title) : "no failure modes recorded";
          return `<div class="pm">Pre-mortem (${esc(pm.status)}): top failure mode ${head}. ${pm.indicators.length} early-warning indicator(s), ${triggered} triggered.</div>`;
        })
        .join("\n");
      const rationale = e.rationale ? `<div class="rationale">"${esc(e.rationale)}"</div>` : "";
      return `<div class="decision">
        <h3>${esc(e.decision.toUpperCase())} on ${esc(e.layerKey)} ${overruledPill(e.overruledStatus)}</h3>
        <div class="line">${esc(isoDate(e.decidedAt))} by ${esc(e.decidedByEmail ?? "unknown")} ${verified}</div>
        <div class="line">System advised: ${advice}</div>
        <div class="line">Outcome: ${outcome}. Running realized to date: ${money(e.cumulativeRealizedValueUsd)}</div>
        ${rationale}
        ${pms}
      </div>`;
    })
    .join("\n");
}

// Render the assembled pack to a complete, standalone HTML document.
export function renderDiligencePackHtml(d: DiligencePackData): string {
  const integrity = d.provenance.ok
    ? `<div class="banner ok">Provenance integrity verified. The hash-chained evidence ledger walked clean across ${d.provenance.length} entr${d.provenance.length === 1 ? "y" : "ies"}.</div>`
    : `<div class="banner bad">Provenance integrity FAILED at entry ${esc(d.provenance.brokenAt)}: ${esc(d.provenance.detail ?? "chain mismatch")}. This document should not be relied upon until the chain is reconciled.</div>`;

  const modeText =
    d.tenant.dataMode === "connected"
      ? "Connected (live connector signals)"
      : "Outside-in (no connected signals; connector-grounded efficacy drivers are structurally capped)";

  const beats =
    d.calibration.beatsBaseline === null
      ? "no resolved forecasts yet"
      : d.calibration.beatsBaseline
        ? "beats the 0.25 coin-flip baseline"
        : "does not yet beat the 0.25 coin-flip baseline";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(d.brand.product)} Diligence Pack - ${esc(d.tenant.name)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header class="cover">
    <div class="eyebrow">${esc(d.brand.product)} Diligence Pack</div>
    <h1>${esc(d.tenant.name)}</h1>
    <div class="sub">Executive intelligence record, current as of export.</div>
    <div class="meta">Generated ${esc(d.generatedAt)} &middot; Data mode: ${esc(modeText)}</div>
  </header>

  <div class="note">This pack is a read-only export of persisted state. Every figure is computed
  from the same append-only records the live product reads; history cannot be edited through this
  document. Verified findings are grounded in evidence; modelled findings are reasoned estimates and
  are labelled as such throughout.</div>

  ${integrity}

  <h2>Data efficacy and calibration record</h2>
  <div class="cards">
    <div class="card"><div class="k">Efficacy rollup</div><div class="v">${score(d.efficacy.rollupScore)}</div>
      <div class="d">Mean of ${d.efficacy.rollupN} generated layer(s). Mode ceiling ${d.efficacy.modeCeiling}.</div></div>
    <div class="card"><div class="k">Forecast Brier</div><div class="v">${brierText(d.calibration.meanBrier)}</div>
      <div class="d">${esc(d.calibration.n)} resolved (${esc(d.calibration.label)}); ${esc(beats)}.</div></div>
    <div class="card"><div class="k">Open forecasts</div><div class="v">${esc(d.calibration.openCount)}</div>
      <div class="d">Awaiting resolution; not yet in the track record.</div></div>
  </div>

  <h2>Current diagnosis, all layers</h2>
  <table>
    <thead><tr><th>Layer</th><th class="num">Efficacy</th><th>Confidence</th><th>Verified</th><th>Modelled</th></tr></thead>
    <tbody>
      ${renderLayerRows(d.layers)}
    </tbody>
  </table>

  <h2>Outcome track record</h2>
  <div class="cards">
    <div class="card"><div class="k">Value identified</div><div class="v">${money(d.outcomes.totalIdentifiedValueUsd)}</div>
      <div class="d">Across ${d.outcomes.commits} committed action(s).</div></div>
    <div class="card"><div class="k">Value realized</div><div class="v">${money(d.outcomes.totalRealizedValueUsd)}</div>
      <div class="d">Measured against committed predictions.</div></div>
    <div class="card"><div class="k">Overruled and right</div><div class="v">${esc(d.outcomes.overruledRight)}</div>
      <div class="d">${esc(d.outcomes.overruledWrong)} overruled and wrong, ${esc(d.outcomes.overruledPending)} pending.</div></div>
  </div>

  <h2>Board decision audit timeline</h2>
  ${renderDecisions(d.decisions)}

  <footer>${esc(d.brand.poweredBy)}. ${esc(d.brand.product)} derives insight from the data it touches
  and discards the data, holding math rather than records. This export contains references and computed
  figures only, never raw underlying data.</footer>
</div>
</body>
</html>`;
}
