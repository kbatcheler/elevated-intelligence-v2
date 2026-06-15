import { eq, isNotNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { deepStripDashes } from "@workspace/cortex";
import { layersTable, type InsertLayer } from "@workspace/db";

// The renderable archetype labels, mirrored from the portal hero registry
// (artifacts/portal/src/components/heroes/registry.ts, the REGISTRY keys). A
// custom layer must pick one of these so its hero renders a real morph rather
// than falling through to the generic hero. There is no shared package both sides
// can import without a new dependency, so customLayer.archetypeSync.test.ts reads
// the portal registry source and asserts this list stays in lockstep: the two can
// never silently drift.
export const ALLOWED_ARCHETYPES = [
  "Performance scorecard",
  "Performance scorecard, benchmark variant",
  "Financial bridge",
  "Flow and funnel",
  "Distribution and sentiment",
  "Network flow map",
  "Cohort and people",
  "Timeline and risk",
  "Aging and collection",
] as const;

export type AllowedArchetype = (typeof ALLOWED_ARCHETYPES)[number];

const trimmedNonEmpty = z.string().trim().min(1);

// The guarded custom-layer template. The owner supplies only the high-signal
// fields the pipeline and hero genuinely need; everything else gets an honest,
// valid-but-empty default at build time (the nine-stage chain grounds only on
// name/description/diagnosticQuestion, and the portal renders an empty registry
// section as an honest empty state). EXACTLY four metric tiles enforces the
// four-tile spec the canonicals follow, and feeds must name at least one source.
// .strict() rejects any unknown field, so a malformed request can never smuggle
// isCanonical, approvedAt, or sortOrder past the template.
export const customLayerTemplateSchema = z
  .object({
    name: trimmedNonEmpty.max(120),
    diagnosticQuestion: trimmedNonEmpty.max(500),
    archetype: z.enum(ALLOWED_ARCHETYPES),
    metricDefinitions: z
      .object({
        tiles: z.array(trimmedNonEmpty.max(160)).length(4),
      })
      .strict(),
    feeds: z.array(trimmedNonEmpty.max(200)).min(1).max(40),
    // Optional, honest extras. When absent each gets an empty or neutral default.
    description: trimmedNonEmpty.max(1000).optional(),
    ownerPersona: z.string().trim().max(200).optional(),
    heroDescription: z.string().trim().max(500).optional(),
    moduleGroup: trimmedNonEmpty.max(120).optional(),
    rootCauses: z.array(trimmedNonEmpty.max(400)).max(40).optional(),
    actions: z.array(trimmedNonEmpty.max(400)).max(40).optional(),
    gaps: z
      .object({
        items: z.array(trimmedNonEmpty.max(400)).max(40),
        closedBy: z.string().trim().max(400),
      })
      .strict()
      .optional(),
    // When set, this layer's signals pool UNDER this canonical key in the
    // benchmark instead of being excluded. The route enforces that the target is
    // an existing canonical layer.
    benchmarkCanonicalKey: trimmedNonEmpty.max(120).optional(),
  })
  .strict();

export type CustomLayerTemplate = z.infer<typeof customLayerTemplateSchema>;

// Derive a stable, ASCII-only, hyphenated key from the display name. ASCII hyphen
// only (the long-dash ban is total): diacritics are decomposed and dropped, every
// run of non-alphanumerics collapses to a single ASCII hyphen, and leading and
// trailing hyphens are trimmed. May return "" for an all-non-ASCII name; the
// route falls back to a base and guarantees global uniqueness by suffixing.
export function slugifyLayerKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface BuildCustomLayerArgs {
  template: CustomLayerTemplate;
  key: string;
  sortOrder: number;
}

// Build the InsertLayer row for a custom layer from a validated template. A custom
// layer is isCanonical=false and starts UNAPPROVED (approvedAt null), so
// loadRegistry will not run it until an owner approves. Fields the template does
// not collect get honest, valid-but-empty defaults: description falls back to the
// diagnostic question (the truest one-line description of what the layer asks),
// the persona/hero strings default empty (the portal renders neutral), the
// cause/action/gap arrays default empty, and moduleGroup defaults to "Custom".
// The whole row is run through deepStripDashes so no long dash can reach the
// database at this new owner-supplied text sink.
export function buildCustomLayerRow(args: BuildCustomLayerArgs): InsertLayer {
  const t = args.template;
  const row: InsertLayer = {
    key: args.key,
    name: t.name,
    description: t.description ?? t.diagnosticQuestion,
    archetype: t.archetype,
    heroDescription: t.heroDescription ?? "",
    ownerPersona: t.ownerPersona ?? "",
    diagnosticQuestion: t.diagnosticQuestion,
    metricDefinitions: { tiles: t.metricDefinitions.tiles },
    rootCauses: t.rootCauses ?? [],
    actions: t.actions ?? [],
    gaps: t.gaps ?? { items: [], closedBy: "" },
    feeds: t.feeds,
    moduleGroup: t.moduleGroup ?? "Custom",
    isCanonical: false,
    sortOrder: args.sortOrder,
    approvedAt: null,
    approvedBy: null,
    benchmarkCanonicalKey: t.benchmarkCanonicalKey ?? null,
  };
  return deepStripDashes(row);
}

// The single definition of which layers are runnable: a layer enters the seed
// fan-out (orchestrator.loadRegistry) and appears in the portal catalog (GET
// /layers) exactly when it is canonical OR an owner has approved it. Both call
// sites share this one predicate so the seed gate and the catalog can never
// disagree about what a custom layer's approval state means.
export function runnableLayerCondition(): SQL | undefined {
  return or(eq(layersTable.isCanonical, true), isNotNull(layersTable.approvedAt));
}
