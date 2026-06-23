import React, { useEffect, useMemo, useState } from "react";
import {
  captureContact,
  fetchQuestionBank,
  submitAssessment,
  type AssessmentResult,
  type ContactOutcome,
  type QuestionBank,
  type ScoredQuestion,
} from "../../lib/assessmentApi";
import { Link, withBase } from "../../lib/router";
import { EmptyState, ErrorState, PageHeader, PageWidth, SkeletonLines } from "../primitives";
import { ResultBody } from "./assessmentParts";

// The free, unauthenticated Intelligence Gap Assessment flow (Phase AT). It
// renders OUTSIDE the auth provider and the app shell: a cold prospect answers
// ten scored questions plus three qualification questions and sees the full
// result ON SCREEN for free. Only the forwardable report is gated, and only on a
// contact, never on payment. No tenant is created here; the optional outside_in
// taste runs server-side after contact and is read back on the report page.

type BankState =
  | { kind: "loading" }
  | { kind: "ready"; bank: QuestionBank }
  | { kind: "error" };

type Phase =
  | { kind: "form" }
  | { kind: "result"; submissionId: string; result: AssessmentResult };

export function AssessmentPage() {
  const [bankState, setBankState] = useState<BankState>({ kind: "loading" });
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sector, setSector] = useState("");
  const [revenueBand, setRevenueBand] = useState("");
  const [systems, setSystems] = useState<string[]>([]);
  const [companyUrl, setCompanyUrl] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchQuestionBank().then((out) => {
      if (!alive) return;
      setBankState(out.state === "ready" ? { kind: "ready", bank: out.bank } : { kind: "error" });
    });
    return () => {
      alive = false;
    };
  }, []);

  const scored: ScoredQuestion[] = bankState.kind === "ready" ? bankState.bank.scored : [];
  const complete = useMemo(
    () => scored.length > 0 && scored.every((q) => answers[q.id]) && sector !== "" && revenueBand !== "",
    [scored, answers, sector, revenueBand],
  );

  async function onSubmit() {
    if (!complete || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const out = await submitAssessment({
      answers,
      qualification: { sector, revenueBand, systems },
      companyUrl: companyUrl.trim() === "" ? null : companyUrl.trim(),
    });
    setSubmitting(false);
    if (out.state === "ready") {
      setPhase({ kind: "result", submissionId: out.submissionId, result: out.result });
      const scroller = document.querySelector(".assessment-flow");
      if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
      return;
    }
    setSubmitError(
      out.state === "invalid"
        ? "Some answers were not understood. Please review and try again."
        : "We could not score your assessment just now. Please try again.",
    );
  }

  return (
    <div className="scroll-area assessment-flow h-full overflow-y-auto bg-cream">
      <PageWidth space="wide">
        <PageHeader
          eyebrow="Free assessment"
          title="The Intelligence Gap Assessment"
          subtitle="Ten short questions on how your business sees, decides and trusts its own numbers. Your result is free and on screen. No account needed."
        />

        <div className="mt-7">
          {bankState.kind === "loading" && <SkeletonLines lines={8} />}
          {bankState.kind === "error" && (
            <ErrorState
              message="The assessment could not be loaded."
              onRetry={() => location.reload()}
            />
          )}

          {bankState.kind === "ready" && phase.kind === "form" && (
            <FormView
              bank={bankState.bank}
              answers={answers}
              onAnswer={(id, key) => setAnswers((prev) => ({ ...prev, [id]: key }))}
              sector={sector}
              onSector={setSector}
              revenueBand={revenueBand}
              onRevenueBand={setRevenueBand}
              systems={systems}
              onToggleSystem={(key) =>
                setSystems((prev) =>
                  prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key],
                )
              }
              companyUrl={companyUrl}
              onCompanyUrl={setCompanyUrl}
              complete={complete}
              submitting={submitting}
              submitError={submitError}
              onSubmit={onSubmit}
            />
          )}

          {phase.kind === "result" && (
            <div className="grid gap-4">
              <ResultBody result={phase.result} />
              <ContactPanel submissionId={phase.submissionId} hasUrl={companyUrl.trim() !== ""} />
            </div>
          )}
        </div>
      </PageWidth>
    </div>
  );
}

function Option({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        "text-left rounded-xl px-4 py-3 text-[14px] transition-colors " +
        (selected
          ? "border-2 border-teal bg-cream-light text-navy font-semibold"
          : "border border-cream-dark bg-white text-slate-base hover:border-slate-light")
      }
    >
      {children}
    </button>
  );
}

function FormView(props: {
  bank: QuestionBank;
  answers: Record<string, string>;
  onAnswer: (id: string, key: string) => void;
  sector: string;
  onSector: (key: string) => void;
  revenueBand: string;
  onRevenueBand: (key: string) => void;
  systems: string[];
  onToggleSystem: (key: string) => void;
  companyUrl: string;
  onCompanyUrl: (v: string) => void;
  complete: boolean;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  const { bank } = props;
  const dimLabel = new Map(bank.dimensions.map((d) => [d.key, d.label]));
  const answered = bank.scored.filter((q) => props.answers[q.id]).length;

  return (
    <div className="grid gap-4">
      {bank.scored.map((q, i) => (
        <section key={q.id} className="card p-6">
          <div className="eyebrow text-slate-light mb-1">
            Question {i + 1} of {bank.scored.length} - {dimLabel.get(q.dimension) ?? q.dimension}
          </div>
          <div className="font-serif text-[17px] text-navy leading-snug mb-3.5">{q.prompt}</div>
          <div className="grid gap-2.5">
            {q.options.map((o) => (
              <Option
                key={o.key}
                selected={props.answers[q.id] === o.key}
                onClick={() => props.onAnswer(q.id, o.key)}
              >
                {o.label}
              </Option>
            ))}
          </div>
        </section>
      ))}

      {bank.qualification.map((q) => (
        <section key={q.id} className="card p-6">
          <div className="font-serif text-[17px] text-navy leading-snug mb-3.5">{q.prompt}</div>
          <div className="grid gap-2.5">
            {q.options.map((o) => {
              const selected =
                q.id === "sector"
                  ? props.sector === o.key
                  : q.id === "revenueBand"
                    ? props.revenueBand === o.key
                    : props.systems.includes(o.key);
              const onClick = () => {
                if (q.id === "sector") props.onSector(o.key);
                else if (q.id === "revenueBand") props.onRevenueBand(o.key);
                else props.onToggleSystem(o.key);
              };
              return (
                <Option key={o.key} selected={selected} onClick={onClick}>
                  {o.label}
                </Option>
              );
            })}
          </div>
        </section>
      ))}

      <section className="card p-6">
        <div className="font-serif text-[17px] text-navy leading-snug mb-1.5">
          Want a quick look at your public footprint too?
        </div>
        <p className="text-[13.5px] text-slate-base leading-relaxed mt-0 mb-3.5">
          Optional. Add your website and we will fold a brief outside-in read into your report. We
          read only your public homepage and create no account.
        </p>
        <input
          type="url"
          inputMode="url"
          placeholder="https://yourcompany.com"
          value={props.companyUrl}
          onChange={(e) => props.onCompanyUrl(e.target.value)}
          className="w-full rounded-xl border border-cream-dark bg-white px-4 py-3 text-[14px] text-navy"
        />
      </section>

      {props.submitError && <ErrorState message={props.submitError} />}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="eyebrow text-slate-light">
          {answered} of {bank.scored.length} answered
        </div>
        <button
          className="btn-primary"
          disabled={!props.complete || props.submitting}
          onClick={props.onSubmit}
        >
          {props.submitting ? "Scoring..." : "See my result"}
        </button>
      </div>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ContactPanel({ submissionId, hasUrl }: { submissionId: string; hasUrl: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<ContactOutcome, { state: "ready" }> | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit() {
    if (busy) return;
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email so we can send your report.");
      return;
    }
    setBusy(true);
    setError(null);
    const out = await captureContact(submissionId, {
      name: name.trim() === "" ? null : name.trim(),
      email: email.trim(),
      company: company.trim() === "" ? null : company.trim(),
    });
    setBusy(false);
    if (out.state === "ready") setResult(out);
    else if (out.state === "invalid") setError("Please check your details and try again.");
    else setError("We could not create your report just now. Please try again.");
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.reportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (result) {
    const emailNote =
      result.emailStatus === "sent"
        ? "We have emailed a copy to you."
        : result.emailStatus === "failed"
          ? "We could not email a copy just now, but your link is ready."
          : "Your report is ready at the link below.";
    return (
      <section className="card card-accent-teal p-6">
        <div className="eyebrow text-slate-light mb-1">Your forwardable report is ready</div>
        <div className="font-serif text-title font-bold text-navy mb-1.5">Open, print or forward it</div>
        <p className="text-[14px] text-slate-base leading-relaxed mt-0 mb-4">
          {emailNote}
          {result.diagnosisRequested
            ? " We are also taking a brief look at your public website. Open your report in a minute to see it."
            : ""}
        </p>
        <div className="flex gap-2.5 flex-wrap">
          <Link to={result.reportPath} className="btn-primary no-underline">
            Open your report
          </Link>
          <button className="btn-ghost" onClick={copyLink}>
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card card-accent-teal p-6">
      <div className="eyebrow text-slate-light mb-1">Keep this</div>
      <div className="font-serif text-title font-bold text-navy mb-1.5">
        Get the forwardable report
      </div>
      <p className="text-[14px] text-slate-base leading-relaxed mt-0 mb-4">
        Your result above is yours to keep on screen for free. Leave your details and we will give
        you a clean, printable version you can forward to your team.
        {hasUrl ? " We will also fold in the brief look at your public website." : ""}
      </p>
      <div className="grid gap-2.5 md:grid-cols-2">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl border border-cream-dark bg-white px-4 py-3 text-[14px] text-navy"
        />
        <input
          type="text"
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="rounded-xl border border-cream-dark bg-white px-4 py-3 text-[14px] text-navy"
        />
      </div>
      <input
        type="email"
        inputMode="email"
        placeholder="Work email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-2.5 w-full rounded-xl border border-cream-dark bg-white px-4 py-3 text-[14px] text-navy"
      />
      {error && <div className="text-caption text-coral-ink mt-2.5">{error}</div>}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button className="btn-primary" disabled={busy} onClick={onSubmit}>
          {busy ? "Preparing..." : "Get my report"}
        </button>
        <a href={withBase("/")} className="font-mono text-[12.5px] text-slate-light no-underline">
          Powered by Elevated Intelligence
        </a>
      </div>
    </section>
  );
}
