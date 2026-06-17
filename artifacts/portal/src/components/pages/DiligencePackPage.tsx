import React from "react";
import { useTenant } from "../../lib/TenantContext";
import { diligencePackUrl } from "../../lib/replayApi";
import { safeDownloadName } from "../../lib/replayView";
import { EmptyState, PageHeader, PageWidth, Pill, SkeletonLines } from "../primitives";

// The diligence pack export surface (Phase AM). The pack itself is a single,
// self-contained, brand-styled HTML document the server renders from the same
// persisted state the live surfaces read: the current 14-layer diagnosis, the
// data-efficacy and calibration record, the board decision audit timeline, the
// outcome track record, and a provenance integrity attestation. This page does
// not re-render that content (which would risk drift); it explains what the pack
// contains and opens or downloads the authoritative server-rendered document.
export function DiligencePackPage() {
  const { currentId, current, status: tenantStatus } = useTenant();

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Export"
        title="Diligence pack"
        subtitle={
          current
            ? `A single, self-contained document of the full record for ${current.name}, assembled from the same persisted state these surfaces read. Honest modelled versus verified throughout; it exports the record, it never edits it.`
            : undefined
        }
      />

      <div style={{ marginTop: 24 }}>
        {tenantStatus === "loading" && <SkeletonLines lines={5} />}
        {tenantStatus === "error" && (
          <EmptyState
            title="No tenant available"
            message="The tenant list could not be loaded. Reload to try again."
          />
        )}
        {tenantStatus === "empty" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its diligence pack can be exported here."
          />
        )}
        {(tenantStatus === "ready") && current && currentId && (
          <PackPanel tenantId={currentId} tenantName={current.name} />
        )}
      </div>
    </PageWidth>
  );
}

function PackPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const url = diligencePackUrl(tenantId);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a className="btn-primary" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", fontSize: 13 }}>
            Open diligence pack
          </a>
          <a className="btn-ghost" href={url} download={`diligence-pack-${safeDownloadName(tenantName)}.html`} style={{ textDecoration: "none", fontSize: 13 }}>
            Download
          </a>
          <span style={{ fontSize: 12, color: "var(--slate-light)" }}>
            Opens a self-contained, brand-styled HTML document. Print to PDF from your browser for a fixed copy.
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill color="navy">Live data</Pill>
          <Pill color="teal">Verified vs modelled labelled</Pill>
          <Pill color="gray">Read only</Pill>
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <span className="eyebrow" style={{ color: "var(--slate-light)" }}>
          What the pack contains
        </span>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8, fontSize: 13.5, color: "var(--slate)", lineHeight: 1.5 }}>
          <li>The current 14-layer diagnosis, each with its confidence and data-efficacy index.</li>
          <li>The data-efficacy and Brier-scored calibration record, with honest sample-size labels.</li>
          <li>The board decision audit timeline: every commit, defer and reject, with the advice at the time.</li>
          <li>The outcome track record: value identified versus value realised across graded outcomes.</li>
          <li>A provenance integrity attestation: the hash-chained ledger re-walked and its verdict stated.</li>
        </ul>
        <span style={{ fontSize: 12, color: "var(--slate-light)" }}>
          Every figure is computed from persisted state for {tenantName}. A figure that cannot be computed is shown as
          unavailable, never fabricated.
        </span>
      </div>
    </div>
  );
}
