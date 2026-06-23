// Assemble the prospect-facing payloads for the Intelligence Gap Assessment
// (Phase AT). The on-screen result is free and carries no diagnosis; the
// forwardable report adds the optional outside_in diagnosis read honestly from
// its status. Both are built from the prospect's own persisted answers plus the
// canonical layer registry, never from a fabricated figure.

import { inArray } from "drizzle-orm";
import {
  db,
  layersTable,
  type AssessmentDiagnosisSnapshot,
  type AssessmentDiagnosisStatus,
  type AssessmentSubmission,
} from "@workspace/db";
import {
  buildCostFraming,
  buildNarrative,
  computeScores,
  ONE_LINE,
  selectGapLayers,
  type ScoreBand,
} from "./scoring";
import { systemLabel } from "./questions";

const MAX_GAP_LAYERS = 5;

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
  // The single Different Day capability that closes the gap, from the registry.
  closes: string;
  // Why this layer surfaced, derived from the prospect's own weak dimensions.
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
  status: AssessmentDiagnosisStatus;
  domain: string | null;
  profile: AssessmentDiagnosisSnapshot["profile"];
  provenance: "verified" | "modelled" | "unavailable";
  homepage: AssessmentDiagnosisSnapshot["homepage"] | null;
}

export interface AssessmentReport extends AssessmentResult {
  // null only when no diagnosis was ever requested (no company url supplied).
  diagnosis: ReportDiagnosis | null;
  contactCaptured: boolean;
}

const DIM_LABEL: Record<string, string> = {
  visibility: "visibility",
  speed: "speed",
  foresight: "foresight",
  confidence: "confidence",
};

function reasonFor(dimensions: string[]): string {
  const labels = dimensions.map((d) => DIM_LABEL[d] ?? d);
  const list =
    labels.length <= 1
      ? labels[0] ?? "your answers"
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Your answers on ${list} point here.`;
}

// Build the free on-screen result from the prospect's validated answers and
// qualification. Recomputes the scores deterministically (pure, so identical to
// what was persisted) and maps the weak answers onto the canonical layers,
// looking up each layer's real name and the capability that closes it.
export async function assembleResult(input: {
  answers: Record<string, string>;
  qualification: { sector: string; revenueBand: string; systems: string[] };
}): Promise<AssessmentResult> {
  const answers = input.answers as Record<string, "blind" | "partial" | "ahead">;
  const scores = computeScores(answers);
  const narrative = buildNarrative(scores);
  const cost = buildCostFraming(scores, input.qualification.revenueBand);
  const selection = selectGapLayers(answers).slice(0, MAX_GAP_LAYERS);

  let gapToLayers: ReportGapLayer[] = [];
  if (selection.length > 0) {
    const keys = selection.map((s) => s.layerKey);
    const rows = await db
      .select({
        key: layersTable.key,
        name: layersTable.name,
        moduleGroup: layersTable.moduleGroup,
        gaps: layersTable.gaps,
      })
      .from(layersTable)
      .where(inArray(layersTable.key, keys));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    gapToLayers = selection
      .map((s) => {
        const row = byKey.get(s.layerKey);
        if (!row) return null;
        return {
          layerKey: s.layerKey,
          layerName: row.name,
          moduleGroup: row.moduleGroup,
          closes: row.gaps.closedBy,
          reason: reasonFor(s.dimensions),
        } satisfies ReportGapLayer;
      })
      .filter((x): x is ReportGapLayer => x !== null);
  }

  const systems: ReportSystem[] = input.qualification.systems
    .map((key) => {
      const label = systemLabel(key);
      return label ? { key, label } : null;
    })
    .filter((x): x is ReportSystem => x !== null);

  return {
    dimensions: scores.dimensions,
    overall: scores.overall,
    gap: { headline: narrative.headline, paragraphs: narrative.paragraphs },
    gapToLayers,
    oneLine: ONE_LINE,
    cost: { lines: cost.lines },
    systems,
    cta: { label: "See this on your own business", href: "/" },
  };
}

// Build the forwardable report from a persisted submission row: the free result
// plus the optional diagnosis read honestly from its status column. The
// diagnosis NEVER carries raw HTML or a model snippet, only the narrow profile
// projection and honest fetch metadata.
export async function assembleReport(row: AssessmentSubmission): Promise<AssessmentReport> {
  const result = await assembleResult({
    answers: row.answers,
    qualification: row.qualification,
  });

  const snap = row.diagnosis;
  const diagnosis: ReportDiagnosis | null =
    row.diagnosisStatus === "not_requested"
      ? null
      : {
          status: row.diagnosisStatus,
          domain: snap?.domain ?? null,
          profile: snap?.profile ?? null,
          provenance: snap?.provenance ?? "unavailable",
          homepage: snap?.homepage ?? null,
        };

  return {
    ...result,
    diagnosis,
    contactCaptured: row.contactCapturedAt != null,
  };
}
