// Company profile schema produced by the profile stage. Strict on the fields
// the tenant shell needs to render; permissive on the rest. The profile is
// stored whole on tenant_profile.profile and its scalar fields also populate
// the tenants row.

import { z } from "zod/v4";

export const profileSchema = z.object({
  name: z.string().min(1).max(120),
  // The seed already owns the canonical URL, so the runner injects it after the
  // model answers; the model is never asked to echo it back.
  url: z.string().min(1).max(200).optional(),
  sector: z.string().max(160).optional(),
  hqCity: z.string().max(80).optional(),
  hqState: z.string().max(80).optional(),
  revenueBand: z.string().max(80).optional(),
  ownership: z.string().max(160).optional(),
  founded: z.number().int().min(1500).max(2100).optional(),
  tagline: z.string().max(400).optional(),
  logoMonogram: z.string().min(1).max(4),
  // Named entities really associated with this company: competitors, suppliers,
  // channels, regions, product categories, leaders. Keys are entity labels,
  // values a short role. Tolerate a model that hands back an array of names by
  // joining it, so a shape slip never fails the whole profile. Bounded.
  vocab: z
    .record(
      z.string(),
      z
        .union([z.string(), z.array(z.string())])
        .transform((v) => (Array.isArray(v) ? v.join(", ") : v).slice(0, 200)),
    )
    .optional(),
  headlines: z
    .object({
      revenueActual: z.string().max(40).optional(),
      revenuePlan: z.string().max(40).optional(),
      revenueVarPct: z.string().max(20).optional(),
      revenueVarDollars: z.string().max(40).optional(),
      marginActual: z.string().max(20).optional(),
      marginTarget: z.string().max(20).optional(),
      marginVarBps: z.string().max(20).optional(),
      cashActual: z.string().max(40).optional(),
      cashVar: z.string().max(60).optional(),
      cashTone: z.enum(["good", "warn", "bad"]).optional(),
      npsActual: z.number().min(-100).max(100).optional(),
      npsDelta: z.string().max(60).optional(),
    })
    .optional(),
  executiveRead: z.string().max(2000).optional(),
  pullQuote: z.string().max(500).optional(),
});
export type ProfileOutput = z.infer<typeof profileSchema>;
