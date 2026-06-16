// Phase AK Data Efficacy Index configuration. One documented place for the
// driver weights and thresholds, so "how good is the data behind this layer"
// cannot be quietly retuned to flatter a tenant. Confidence says how sure the
// reasoning is; efficacy says how good the fuel was. The weights below sum to 1
// at their defaults and are renormalized if an operator overrides them, so the
// index is always a weighted average over the five named drivers.

import type { ConnectorFamily } from "@workspace/connectors";

export type EfficacyDriverKey =
  | "coverage"
  | "freshness"
  | "verificationRate"
  | "adversarialSurvival"
  | "sourceDiversity";

export const EFFICACY_DRIVER_KEYS: EfficacyDriverKey[] = [
  "coverage",
  "freshness",
  "verificationRate",
  "adversarialSurvival",
  "sourceDiversity",
];

export const EFFICACY_DRIVER_LABELS: Record<EfficacyDriverKey, string> = {
  coverage: "Coverage",
  freshness: "Freshness",
  verificationRate: "Verification rate",
  adversarialSurvival: "Adversarial survival",
  sourceDiversity: "Source diversity",
};

// The default driver weights. Coverage and verification carry the most because
// "is the data even present" and "is the claim verified or only modelled" are
// the two questions a buyer asks first; freshness and adversarial survival
// temper that; source diversity rewards triangulation. They sum to 1.0.
export const DEFAULT_EFFICACY_WEIGHTS: Record<EfficacyDriverKey, number> = {
  coverage: 0.25,
  freshness: 0.15,
  verificationRate: 0.25,
  adversarialSurvival: 0.15,
  sourceDiversity: 0.2,
};

// Freshness uses a half-life decay against this cadence, mirroring the connector
// catalogue's one-day default staleness window. A signal exactly one threshold
// old reads 0.5; two thresholds old reads 0.25; and anything past the max
// multiple reads 0 rather than an ever-smaller positive number.
export const DEFAULT_FRESHNESS_THRESHOLD_SECONDS = 24 * 60 * 60;
export const DEFAULT_FRESHNESS_MAX_MULTIPLE = 4;

// The number of independent sources behind a layer's diagnosis at which source
// diversity reads a full 1.0. Five distinct sources is a well-triangulated
// finding; fewer scales linearly.
export const DEFAULT_SOURCE_DIVERSITY_TARGET = 5;

// The registry's feed labels are human strings ("GA4", "Accounting and ERP");
// the derived signals carry a connector key whose family is known from the
// catalogue. This map is the documented, no-schema bridge between the two: a
// feed counts as covered when a derived signal for the layer comes from a
// connector in one of the feed's mapped families. A feed with no mapped family
// (for example open "News") is reported as not measurable from connectors,
// never silently guessed as covered or as a permanent miss.
export const DEFAULT_FEED_ALIAS_MAP: Record<string, ConnectorFamily[]> = {
  "Data warehouse or BI": ["warehouse-bi"],
  "Data warehouse": ["warehouse-bi"],
  "Accounting and ERP": ["accounting-erp"],
  ERP: ["accounting-erp"],
  "ERP and finance": ["accounting-erp"],
  "ERP spend": ["accounting-erp"],
  "ERP and inventory": ["accounting-erp", "commerce-pos-inventory"],
  CRM: ["crm-sales"],
  "CRM rollups": ["crm-sales"],
  "CRM win-loss": ["crm-sales"],
  "CRM quotes": ["crm-sales"],
  GA4: ["marketing-web-analytics"],
  "Search Console": ["marketing-web-analytics"],
  "Ad platforms": ["marketing-web-analytics"],
  "Marketing automation": ["marketing-web-analytics"],
  "Web and search": ["marketing-web-analytics"],
  Search: ["marketing-web-analytics"],
  Commerce: ["commerce-pos-inventory"],
  "Commerce and POS": ["commerce-pos-inventory"],
  "Billing and commerce": ["commerce-pos-inventory"],
  Logistics: ["supply-chain-logistics"],
  "EDI or SFTP feeds": ["supply-chain-logistics"],
  HRIS: ["hris-ats"],
  ATS: ["hris-ats"],
  Support: ["support-customer"],
  "Review sites": ["reputation-social"],
  "Review platforms": ["reputation-social"],
  "Social listening": ["reputation-social"],
  CLM: ["contracts-documents"],
  "Document stores": ["contracts-documents"],
  News: [],
};

export interface EfficacyConfig {
  weights: Record<EfficacyDriverKey, number>;
  freshnessThresholdSeconds: number;
  freshnessMaxMultiple: number;
  sourceDiversityTarget: number;
  feedAliasMap: Record<string, ConnectorFamily[]>;
}

function floatFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const WEIGHT_ENV: Record<EfficacyDriverKey, string> = {
  coverage: "EFFICACY_WEIGHT_COVERAGE",
  freshness: "EFFICACY_WEIGHT_FRESHNESS",
  verificationRate: "EFFICACY_WEIGHT_VERIFICATION",
  adversarialSurvival: "EFFICACY_WEIGHT_ADVERSARIAL",
  sourceDiversity: "EFFICACY_WEIGHT_DIVERSITY",
};

export function efficacyConfig(env: NodeJS.ProcessEnv = process.env): EfficacyConfig {
  const weights = {} as Record<EfficacyDriverKey, number>;
  for (const key of EFFICACY_DRIVER_KEYS) {
    weights[key] = floatFromEnv(env, WEIGHT_ENV[key], DEFAULT_EFFICACY_WEIGHTS[key]);
  }
  return {
    weights,
    freshnessThresholdSeconds: intFromEnv(
      env,
      "EFFICACY_FRESHNESS_THRESHOLD_SECONDS",
      DEFAULT_FRESHNESS_THRESHOLD_SECONDS,
    ),
    freshnessMaxMultiple: intFromEnv(
      env,
      "EFFICACY_FRESHNESS_MAX_MULTIPLE",
      DEFAULT_FRESHNESS_MAX_MULTIPLE,
    ),
    sourceDiversityTarget: intFromEnv(
      env,
      "EFFICACY_SOURCE_DIVERSITY_TARGET",
      DEFAULT_SOURCE_DIVERSITY_TARGET,
    ),
    feedAliasMap: DEFAULT_FEED_ALIAS_MAP,
  };
}
