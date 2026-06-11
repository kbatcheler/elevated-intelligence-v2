// Profile stage prompt. The reasoner seat reads a homepage ground-truth snippet
// and produces a real company profile. Grounded facts only; everything else is
// modelled and must read as a plausible estimate, never an asserted figure.

import type { HomepageContext } from "../grounding/homepageContext";
import { STAGE_RULES } from "./shared";

export const PROFILE_SYSTEM_PROMPT = [
  "You are the Lens of an executive intelligence engine. Your job is to build an",
  "accurate, specific profile of ONE real company from the ground-truth snippet of",
  "its homepage plus your own knowledge of it.",
  "",
  "Principles:",
  "- Identify the actual company. Use its real name, sector, and home market.",
  "- The homepage snippet is empirical ground truth. Prefer it over memory when",
  "  they conflict.",
  "- logoMonogram is 1 to 3 letters drawn from the real company name.",
  "- vocab is a map of REAL named entities tied to this company: genuine",
  "  competitors, suppliers, channels, product lines, regions, or leaders. Never",
  "  invent a rival. If you are unsure of a name, leave it out.",
  "- Financial headline fields are OPTIONAL. Fill them only if you can ground the",
  "  figure; otherwise omit them and let executiveRead carry the narrative. Do not",
  "  fabricate revenue, margin, cash, or NPS numbers.",
  "- executiveRead is two to four sentences of specific, non-generic context an",
  "  operator would recognise as true of this exact company.",
  "",
  STAGE_RULES,
].join("\n");

export function buildProfileUser(rawUrl: string, ctx: HomepageContext): string {
  const groundTruth = ctx.ok
    ? `HOMEPAGE GROUND TRUTH (fetched from ${ctx.finalUrl}, ${ctx.bytesExtracted} bytes):\n"""\n${ctx.snippet}\n"""`
    : `HOMEPAGE FETCH FAILED (${ctx.errorReason ?? "unknown"}). Profile from your own knowledge of the company at this URL, and be conservative about anything you cannot verify.`;
  return [
    `TARGET URL: ${rawUrl}`,
    "",
    groundTruth,
    "",
    "Return ONE JSON object with exactly these fields (omit any optional field you",
    "cannot ground; do not invent figures):",
    "{",
    '  "name": "<the real company name>",',
    '  "logoMonogram": "<1 to 3 letters drawn from the name>",',
    '  "sector": "<industry, optional>",',
    '  "hqCity": "<optional>",',
    '  "hqState": "<optional>",',
    '  "revenueBand": "<qualitative band, optional>",',
    '  "ownership": "<e.g. private, public, B Corp, optional>",',
    '  "founded": <year as a number, optional>,',
    '  "tagline": "<short, optional>",',
    '  "vocab": { "<real entity name>": "<one short phrase naming its role, e.g. direct competitor, key wholesale channel, core product line>" },',
    '  "executiveRead": "<2 to 4 specific sentences>",',
    '  "pullQuote": "<optional>"',
    "}",
    "",
    "vocab maps each REAL named entity to a short role string. Do NOT group entities",
    "by category and do NOT use arrays as values. Omit the URL: it is already known.",
  ].join("\n");
}
