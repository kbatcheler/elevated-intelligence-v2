import type { Basis, Tone } from "../../types";

// Tone maps. The four content tones resolve to the palette's status colors and
// to the card top-accent names. Neutral falls back to navy authority.
export const toneColorVar: Record<Tone, string> = {
  good: "var(--teal)",
  warn: "var(--amber)",
  bad: "var(--coral)",
  neutral: "var(--navy)",
};

// The AA-passing ink variants for the same tones. Used for normal-sized text
// (below the WCAG large threshold); the base toneColorVar stays for large
// display figures, chart strokes, and accent bars.
export const toneInkVar: Record<Tone, string> = {
  good: "var(--teal-ink)",
  warn: "var(--amber-ink)",
  bad: "var(--coral-ink)",
  neutral: "var(--navy)",
};

export type AccentName = "teal" | "amber" | "coral" | "navy" | "gold";

export const toneAccent: Record<Tone, AccentName> = {
  good: "teal",
  warn: "amber",
  bad: "coral",
  neutral: "navy",
};

export function basisPillClass(basis: Basis): string {
  return basis === "verified" ? "pill-verified" : "pill-modelled";
}

export function basisLabel(basis: Basis): string {
  return basis === "verified" ? "Verified" : "Modelled";
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Date helpers tolerate null and bad input by returning a plain dash, never a
// fabricated date.
export function formatDate(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)}, ${hh}:${mm}`;
}

export function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatInt(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US");
}

// A whole-dollar USD figure. Returns a plain dash for null or non-finite input,
// never a fabricated $0. Postgres numeric arrives as a string, so the caller
// parses it before formatting; this only formats a real number.
export function formatUsd(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
