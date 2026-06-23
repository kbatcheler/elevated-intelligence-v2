import React, { useEffect, useState } from "react";
import type { AssessmentReport, ReportDiagnosis } from "../../lib/assessmentApi";
import { fetchAssessmentReport } from "../../lib/assessmentApi";
import { withBase } from "../../lib/router";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageWidth,
  Pill,
  ProvenancePill,
  SkeletonLines,
} from "../primitives";
import { ResultBody } from "./assessmentParts";
import "../../styles/assessmentPrint.css";

// The forwardable, printable Intelligence Gap Assessment report (Phase AT). It
// renders OUTSIDE the auth provider: whoever the link is forwarded to has no
// session. A uniform 404 from the server (expired, revoked or unknown) surfaces
// as one honest "unavailable" outcome. The optional outside_in diagnosis is read
// straight from its status, so an in-progress, thin-footprint or failed taste
// reads as exactly that rather than as a fabricated result.

type State =
  | { kind: "loading" }
  | { kind: "ready"; report: AssessmentReport }
  | { kind: "unavailable" }
  | { kind: "error" };

export function AssessmentReportPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchAssessmentReport(token).then((out) => {
      if (!alive) return;
      if (out.state === "unavailable") return setState({ kind: "unavailable" });
      if (out.state === "error") return setState({ kind: "error" });
      setState({ kind: "ready", report: out.report });
    });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="scroll-area h-full overflow-y-auto bg-cream assessment-report">
      <PageWidth space="wide">
        <PageHeader
          eyebrow="Intelligence Gap Assessment"
          title="Your assessment report"
          subtitle="A read-only summary you can forward or print. No account needed."
          actions={
            state.kind === "ready" ? (
              <button className="btn-ghost no-print" onClick={() => window.print()}>
                Print or save as PDF
              </button>
            ) : undefined
          }
        />

        <div className="mt-7">
          {state.kind === "loading" && <SkeletonLines lines={6} />}
          {state.kind === "error" && (
            <ErrorState
              message="This report could not be loaded."
              onRetry={() => location.reload()}
            />
          )}
          {state.kind === "unavailable" && (
            <EmptyState
              title="This link is not available"
              message="The link may have expired, been revoked, or never existed. Ask whoever shared it for a fresh link."
            />
          )}
          {state.kind === "ready" && (
            <div className="grid gap-4">
              <ResultBody result={state.report} />
              {state.report.diagnosis && <DiagnosisPanel diagnosis={state.report.diagnosis} />}
              <PoweredBy />
            </div>
          )}
        </div>
      </PageWidth>
    </div>
  );
}

// The optional outside_in taste. It is never created as a tenant and never
// carries raw page content: only a narrow profile read and honest fetch
// telemetry. Each status renders its own honest shape.
function DiagnosisPanel({ diagnosis }: { diagnosis: ReportDiagnosis }) {
  if (diagnosis.status === "pending" || diagnosis.status === "in_progress") {
    return (
      <section className="card card-accent-teal p-6">
        <div className="eyebrow text-slate-light mb-1">A look at your public footprint</div>
        <div className="font-serif text-[16px] text-navy">We are reading your public website now</div>
        <p className="text-[13.5px] text-slate-base leading-relaxed mt-2 mb-0">
          This is a brief outside-in read. Refresh this page in a minute to see it.
        </p>
      </section>
    );
  }

  if (diagnosis.status === "unavailable") {
    return (
      <section className="card p-6">
        <div className="eyebrow text-slate-light mb-1">A look at your public footprint</div>
        <div className="font-serif text-[16px] text-navy">Your public footprint was too thin to ground a read</div>
        <p className="text-[13.5px] text-slate-base leading-relaxed mt-2 mb-0">
          We will not invent a figure from a page we could not read. The assessment above stands on
          your own answers.
        </p>
      </section>
    );
  }

  if (diagnosis.status === "failed") {
    return (
      <section className="card card-accent-coral p-6">
        <div className="eyebrow text-slate-light mb-1">A look at your public footprint</div>
        <div className="font-serif text-[16px] text-coral-ink">This read could not be completed</div>
        <p className="text-[13.5px] text-slate-base leading-relaxed mt-2 mb-0">
          The assessment above is unaffected. It stands on your own answers.
        </p>
      </section>
    );
  }

  // ready
  const profile = diagnosis.profile;
  return (
    <section className="card card-accent-teal p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="eyebrow text-slate-light">A look at your public footprint</div>
        {(diagnosis.provenance === "verified" || diagnosis.provenance === "modelled") && (
          <ProvenancePill basis={diagnosis.provenance} />
        )}
      </div>
      <div className="font-serif text-title font-bold text-navy mt-1.5">
        {profile?.name || diagnosis.domain || "Your company"}
      </div>
      {profile?.tagline && (
        <p className="font-serif text-[16px] text-navy leading-snug mt-2 mb-0">{profile.tagline}</p>
      )}
      <div className="flex gap-2 flex-wrap mt-3">
        {profile?.sector && <Pill color="navy">{profile.sector}</Pill>}
        {diagnosis.domain && <Pill color="gray">{diagnosis.domain}</Pill>}
      </div>
      <p className="text-[13px] text-slate-base leading-relaxed mt-3 mb-0">
        This is an outside-in read from your public website alone. The full picture comes from your
        own systems, inside a per-tenant boundary.
      </p>
    </section>
  );
}

function PoweredBy() {
  return (
    <div className="mt-4 text-center">
      <a href={withBase("/")} className="font-mono text-[12.5px] text-slate-light no-underline">
        Powered by Elevated Intelligence
      </a>
    </div>
  );
}
