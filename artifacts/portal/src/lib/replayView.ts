// Pure view logic for the as-of replay and diligence pack surfaces (Phase AM).
// Item counting, the changed-since delta style, and the download filename
// sanitiser are extracted so they are unit-testable without rendering the pages.

// Count the well-formed object items in an as-of claims blob. A missing or
// non-array items field counts as zero rather than throwing.
export function countClaimItems(claims: Record<string, unknown> | null): number {
  const items = (claims as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.filter((x) => x != null && typeof x === "object").length : 0;
}

// The sign prefix and ink color for a non-null changed-since delta. A positive
// move reads teal, a negative move coral, and an exact zero stays neutral.
export function deltaStyle(value: number): { sign: string; color: string } {
  const sign = value > 0 ? "+" : "";
  const color = value > 0 ? "var(--teal-ink)" : value < 0 ? "var(--coral-ink)" : "var(--slate-light)";
  return { sign, color };
}

// A filesystem-safe download filename derived from a tenant name, clamped to 80
// characters and never empty.
export function safeDownloadName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "tenant";
}
