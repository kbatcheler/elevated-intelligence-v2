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
    <PageWidth space="page">
      <PageHeader
        eyebrow="Export"
        title="Diligence pack"
        subtitle={
          current
            ? `A single, self-contained document of the full record for ${current.name}, assembled from the same persisted state these surfaces read. Honest modelled versus verified throughout; it exports the record, it never edits it.`
            : undefined
        }
      />

      <div className="mt-6">
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
    <div className="grid gap-4">
      <div className="card grid gap-3.5">
        <div className="flex gap-3 items-center flex-wrap">
          <a className="btn-primary no-underline text-caption" href={url} target="_blank" rel="noreferrer">
            Open diligence pack
          </a>
          <a className="btn-ghost no-underline text-caption" href={url} download={`diligence-pack-${safeDownloadName(tenantName)}.html`}>
            Download
          </a>
          <span className="text-xs text-slate-light">
            Opens a self-contained, brand-styled HTML document. Print to PDF from your browser for a fixed copy.
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Pill color="navy">Live data</Pill>
          <Pill color="teal">Verified vs modelled labelled</Pill>
          <Pill color="gray">Read only</Pill>
        </div>
      </div>

      <div className="card grid gap-2.5">
        <span className="eyebrow text-slate-light">
          What the pack contains
        </span>
        <ul className="m-0 pl-[18px] grid gap-2 text-[13.5px] text-slate-base leading-normal">
          <li>The current 14-layer diagnosis, each with its confidence and data-efficacy index.</li>
          <li>The data-efficacy and Brier-scored calibration record, with honest sample-size labels.</li>
          <li>The board decision audit timeline: every commit, defer and reject, with the advice at the time.</li>
          <li>The outcome track record: value identified versus value realised across graded outcomes.</li>
          <li>A provenance integrity attestation: the hash-chained ledger re-walked and its verdict stated.</li>
        </ul>
        <span className="text-xs text-slate-light">
          Every figure is computed from persisted state for {tenantName}. A figure that cannot be computed is shown as
          unavailable, never fabricated.
        </span>
      </div>
    </div>
  );
}
