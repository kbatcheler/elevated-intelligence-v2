// The Intelligence Gap Assessment client (Phase AT). The funnel is entirely
// unauthenticated: a cold prospect reads the question bank, submits answers for a
// free on-screen result, optionally leaves a contact to unlock a forwardable
// report, and opens that report from a shared link with no session. Every call
// returns a discriminated outcome so the pages render honest loading, empty and
// error states and never a fabricated value.

export type DimensionKey = "visibility" | "speed" | "foresight" | "confidence";
export type ScoreBand = "blind" | "reactive" | "ahead";
export type DiagnosisStatus =
  | "not_requested"
  | "pending"
  | "in_progress"
  | "ready"
  | "unavailable"
  | "failed";

export interface DimensionMeta {
  key: DimensionKey;
  label: string;
  blurb: string;
}
export interface ScoredOption {
  key: string;
  label: string;
}
export interface ScoredQuestion {
  id: string;
  dimension: DimensionKey;
  prompt: string;
  options: ScoredOption[];
}
export interface QualificationOption {
  key: string;
  label: string;
}
export interface QualificationQuestion {
  id: "sector" | "revenueBand" | "systems";
  prompt: string;
  kind: "single" | "multi";
  options: QualificationOption[];
}
export interface QuestionBank {
  dimensions: DimensionMeta[];
  scored: ScoredQuestion[];
  qualification: QualificationQuestion[];
}

export interface ReportDimension {
  key: string;
  label: string;
  blurb: string;
  score: number;
  band: ScoreBand;
}
export interface ReportGapLayer {
  layerKey: string;
  layerName: string;
  moduleGroup: string;
  closes: string;
  reason: string;
}
export interface ReportSystem {
  key: string;
  label: string;
}
export interface AssessmentResult {
  dimensions: ReportDimension[];
  overall: { score: number; band: ScoreBand };
  gap: { headline: string; paragraphs: string[] };
  gapToLayers: ReportGapLayer[];
  oneLine: string;
  cost: { lines: string[] };
  systems: ReportSystem[];
  cta: { label: string; href: string };
}
export interface ReportDiagnosis {
  status: DiagnosisStatus;
  domain: string | null;
  profile: { name: string; sector: string | null; tagline: string | null; url: string | null } | null;
  provenance: "verified" | "modelled" | "unavailable";
  homepage: {
    ok: boolean;
    status: number;
    bytesFetched: number;
    bytesExtracted: number;
    durationMs: number;
  } | null;
}
export interface AssessmentReport extends AssessmentResult {
  diagnosis: ReportDiagnosis | null;
  contactCaptured: boolean;
}

export interface Qualification {
  sector: string;
  revenueBand: string;
  systems: string[];
}

export type QuestionsOutcome =
  | { state: "ready"; bank: QuestionBank }
  | { state: "error" };

export async function fetchQuestionBank(): Promise<QuestionsOutcome> {
  try {
    const res = await fetch("/api/public/assessment/questions");
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { questions: QuestionBank };
    return { state: "ready", bank: data.questions };
  } catch {
    return { state: "error" };
  }
}

export type SubmitOutcome =
  | { state: "ready"; submissionId: string; result: AssessmentResult }
  | { state: "invalid"; detail: string }
  | { state: "error" };

export async function submitAssessment(input: {
  answers: Record<string, string>;
  qualification: Qualification;
  companyUrl: string | null;
}): Promise<SubmitOutcome> {
  try {
    const res = await fetch("/api/public/assessment/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      return { state: "invalid", detail: data.detail ?? "Some answers were not understood." };
    }
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { submissionId: string; result: AssessmentResult };
    return { state: "ready", submissionId: data.submissionId, result: data.result };
  } catch {
    return { state: "error" };
  }
}

export type ContactOutcome =
  | {
      state: "ready";
      reportPath: string;
      reportUrl: string;
      emailStatus: "sent" | "not_connected" | "failed";
      diagnosisRequested: boolean;
    }
  | { state: "invalid" }
  | { state: "error" };

export async function captureContact(
  submissionId: string,
  contact: { name: string | null; email: string; company: string | null },
): Promise<ContactOutcome> {
  try {
    const res = await fetch(
      `/api/public/assessment/submissions/${encodeURIComponent(submissionId)}/contact`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contact),
      },
    );
    if (res.status === 400) return { state: "invalid" };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as {
      reportPath: string;
      reportUrl: string;
      emailStatus: "sent" | "not_connected" | "failed";
      diagnosisRequested: boolean;
    };
    return {
      state: "ready",
      reportPath: data.reportPath,
      reportUrl: data.reportUrl,
      emailStatus: data.emailStatus,
      diagnosisRequested: data.diagnosisRequested,
    };
  } catch {
    return { state: "error" };
  }
}

export type ReportOutcome =
  | { state: "ready"; report: AssessmentReport }
  | { state: "unavailable" }
  | { state: "error" };

export async function fetchAssessmentReport(token: string): Promise<ReportOutcome> {
  try {
    const res = await fetch(`/api/public/assessment/report/${encodeURIComponent(token)}`);
    if (res.status === 404) return { state: "unavailable" };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { report: AssessmentReport };
    return { state: "ready", report: data.report };
  } catch {
    return { state: "error" };
  }
}
