import { describe, expect, it } from "vitest";
import {
  ALLOWED_ARCHETYPES,
  buildCustomLayerRow,
  customLayerTemplateSchema,
  slugifyLayerKey,
} from "./customLayer";

const validTemplate = {
  name: "Revenue Retention",
  diagnosticQuestion: "Where is recurring revenue leaking?",
  archetype: "Performance scorecard" as const,
  metricDefinitions: { tiles: ["Gross retention", "Net retention", "Logo churn", "Expansion"] },
  feeds: ["billing", "crm"],
};

describe("customLayerTemplateSchema", () => {
  it("accepts a minimal valid template", () => {
    expect(customLayerTemplateSchema.safeParse(validTemplate).success).toBe(true);
  });

  it("requires exactly four metric tiles", () => {
    expect(
      customLayerTemplateSchema.safeParse({
        ...validTemplate,
        metricDefinitions: { tiles: ["a", "b", "c"] },
      }).success,
    ).toBe(false);
    expect(
      customLayerTemplateSchema.safeParse({
        ...validTemplate,
        metricDefinitions: { tiles: ["a", "b", "c", "d", "e"] },
      }).success,
    ).toBe(false);
  });

  it("rejects an archetype outside the renderable set", () => {
    expect(
      customLayerTemplateSchema.safeParse({ ...validTemplate, archetype: "Made up archetype" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty feeds list", () => {
    expect(customLayerTemplateSchema.safeParse({ ...validTemplate, feeds: [] }).success).toBe(false);
  });

  it("rejects unknown fields (strict), so isCanonical or approvedAt cannot be smuggled in", () => {
    expect(customLayerTemplateSchema.safeParse({ ...validTemplate, isCanonical: true }).success).toBe(
      false,
    );
    expect(
      customLayerTemplateSchema.safeParse({ ...validTemplate, sortOrder: 1 }).success,
    ).toBe(false);
  });

  it("rejects blank required strings", () => {
    expect(customLayerTemplateSchema.safeParse({ ...validTemplate, name: "   " }).success).toBe(
      false,
    );
  });

  it("accepts the optional benchmark mapping and extra content", () => {
    expect(
      customLayerTemplateSchema.safeParse({
        ...validTemplate,
        description: "Tracks recurring revenue durability.",
        benchmarkCanonicalKey: "finance",
        rootCauses: ["pricing", "onboarding"],
        gaps: { items: ["no churn alerting"], closedBy: "Different Day" },
      }).success,
    ).toBe(true);
  });
});

describe("slugifyLayerKey", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugifyLayerKey("Revenue Retention")).toBe("revenue-retention");
  });

  it("collapses punctuation and trims leading and trailing hyphens", () => {
    expect(slugifyLayerKey("  Cash!! Flow & Burn  ")).toBe("cash-flow-burn");
  });

  it("drops diacritics down to ASCII", () => {
    expect(slugifyLayerKey("Cafe\u0301 Me\u0301trics")).toBe("cafe-metrics");
  });

  it("returns empty for an all-symbol name so the route can fall back", () => {
    expect(slugifyLayerKey("***")).toBe("");
  });
});

describe("buildCustomLayerRow", () => {
  it("builds an unapproved custom layer with honest defaults", () => {
    const row = buildCustomLayerRow({
      template: validTemplate,
      key: "revenue-retention",
      sortOrder: 15,
    });
    expect(row.isCanonical).toBe(false);
    expect(row.approvedAt).toBeNull();
    expect(row.approvedBy).toBeNull();
    expect(row.benchmarkCanonicalKey).toBeNull();
    expect(row.sortOrder).toBe(15);
    expect(row.key).toBe("revenue-retention");
    // description falls back to the diagnostic question when not supplied.
    expect(row.description).toBe(validTemplate.diagnosticQuestion);
    expect(row.moduleGroup).toBe("Custom");
    expect(row.ownerPersona).toBe("");
    expect(row.heroDescription).toBe("");
    expect(row.rootCauses).toEqual([]);
    expect(row.actions).toEqual([]);
    expect(row.gaps).toEqual({ items: [], closedBy: "" });
    expect(row.metricDefinitions).toEqual({ tiles: validTemplate.metricDefinitions.tiles });
    expect(row.feeds).toEqual(validTemplate.feeds);
  });

  it("strips long dashes from owner-supplied text at the persistence sink", () => {
    const row = buildCustomLayerRow({
      template: {
        ...validTemplate,
        name: "Revenue \u2014 Retention",
        description: "Range 10\u201320 percent",
      },
      key: "k",
      sortOrder: 1,
    });
    expect(row.name).toBe("Revenue - Retention");
    expect(row.description).toBe("Range 10-20 percent");
    expect(row.name).not.toContain("\u2014");
    expect(row.description).not.toContain("\u2013");
  });

  it("carries an explicit benchmark canonical key through unchanged", () => {
    const row = buildCustomLayerRow({
      template: { ...validTemplate, benchmarkCanonicalKey: "finance" },
      key: "k2",
      sortOrder: 2,
    });
    expect(row.benchmarkCanonicalKey).toBe("finance");
  });
});

describe("ALLOWED_ARCHETYPES", () => {
  it("has no duplicate labels", () => {
    expect(new Set(ALLOWED_ARCHETYPES).size).toBe(ALLOWED_ARCHETYPES.length);
  });
});
