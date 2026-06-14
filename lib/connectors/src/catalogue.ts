import type {
  AuthMethod,
  ConnectorDescriptor,
  ConnectorFamily,
  DataPath,
  DeploymentMode,
} from "./contract";

// The layers each family feeds, taken straight from the spec. These keys are the
// 14 canonical layer keys; the layer registry remains the single source of truth
// for layer identity, and a test validates every entry against it.
const FAMILY_LAYERS: Record<ConnectorFamily, string[]> = {
  "accounting-erp": ["finance", "receivables", "business-performance", "pricing-margin"],
  "crm-sales": ["sales-pipeline", "customer-intelligence", "business-performance"],
  "marketing-web-analytics": ["marketing-performance", "demand-intelligence", "brand-social"],
  "commerce-pos-inventory": [
    "demand-intelligence",
    "supply-chain",
    "pricing-margin",
    "receivables",
  ],
  "supply-chain-logistics": ["supply-chain"],
  "hris-ats": ["people-operations", "talent-hr"],
  "contracts-documents": ["contract-management"],
  "support-customer": ["customer-intelligence", "brand-social"],
  "reputation-social": ["brand-social", "competitive-intelligence"],
  // The bring-your-own-warehouse path can feed any layer.
  "warehouse-bi": [
    "business-performance",
    "finance",
    "demand-intelligence",
    "competitive-intelligence",
    "customer-intelligence",
    "brand-social",
    "supply-chain",
    "pricing-margin",
    "sales-pipeline",
    "marketing-performance",
    "people-operations",
    "contract-management",
    "receivables",
    "talent-hr",
  ],
};

// Representative derived-signal keys each family can emit. These are declared
// capabilities, not data values: nothing here is a measurement, only a statement
// of what a connector in this family would compute and return as math.
const FAMILY_SIGNALS: Record<ConnectorFamily, string[]> = {
  "accounting-erp": [
    "gross_margin_pct",
    "revenue_trend_delta",
    "ar_days_outstanding",
    "expense_ratio",
  ],
  "crm-sales": [
    "pipeline_coverage_ratio",
    "win_rate_pct",
    "sales_cycle_days",
    "stage_distribution",
  ],
  "marketing-web-analytics": [
    "conversion_rate_pct",
    "cac_trend_delta",
    "channel_mix_distribution",
    "engagement_index",
  ],
  "commerce-pos-inventory": [
    "sell_through_rate_pct",
    "inventory_turns",
    "aov_trend_delta",
    "stockout_ratio",
  ],
  "supply-chain-logistics": [
    "on_time_delivery_pct",
    "lead_time_days",
    "fulfillment_cost_index",
    "backlog_ratio",
  ],
  "hris-ats": [
    "attrition_rate_pct",
    "time_to_hire_days",
    "headcount_trend_delta",
    "offer_acceptance_pct",
  ],
  "contracts-documents": [
    "renewal_rate_pct",
    "contract_cycle_days",
    "obligation_distribution",
    "expiry_risk_index",
  ],
  "support-customer": [
    "csat_index",
    "first_response_hours",
    "ticket_volume_trend_delta",
    "resolution_rate_pct",
  ],
  "reputation-social": [
    "sentiment_index",
    "review_volume_trend_delta",
    "rating_distribution",
    "share_of_voice_pct",
  ],
  // Warehouse connectors compute whatever aggregate the client configures per
  // tenant; these are representative shapes, not a fixed list.
  "warehouse-bi": [
    "record_volume",
    "completion_ratio",
    "status_distribution",
    "period_trend_delta",
  ],
};

function d(
  key: string,
  name: string,
  family: ConnectorFamily,
  authMethod: AuthMethod,
  deployment: DeploymentMode,
  path: DataPath,
  overrides: Partial<ConnectorDescriptor> = {},
): ConnectorDescriptor {
  return {
    key,
    name,
    family,
    layers: FAMILY_LAYERS[family],
    authMethod,
    deployment,
    path,
    signalsProduced: FAMILY_SIGNALS[family],
    status: "available",
    implemented: false,
    ...overrides,
  };
}

// The full connector catalogue. Every connector named in the spec is declared
// here and mapped to its layers, even where the runtime is not yet implemented.
// Only the two bring-your-own-warehouse reference connectors are implemented in
// this phase; the rest are honest declarations that render as "available, not
// connected" until their runtime lands.
export const CATALOGUE: ConnectorDescriptor[] = [
  // Accounting and ERP
  d("quickbooks-online", "QuickBooks Online", "accounting-erp", "oauth2", "edge", "edge-agent"),
  d("xero", "Xero", "accounting-erp", "oauth2", "edge", "edge-agent"),
  d("netsuite", "Oracle NetSuite", "accounting-erp", "oauth2", "boundary", "boundary-runtime"),
  d("sage-intacct", "Sage Intacct", "accounting-erp", "apiKey", "edge", "edge-agent"),
  d(
    "microsoft-dynamics-erp",
    "Microsoft Dynamics 365 Finance",
    "accounting-erp",
    "oauth2",
    "edge",
    "edge-agent",
  ),

  // CRM and sales
  d("salesforce", "Salesforce", "crm-sales", "oauth2", "edge", "edge-agent"),
  d("hubspot", "HubSpot CRM", "crm-sales", "oauth2", "edge", "edge-agent"),
  d("pipedrive", "Pipedrive", "crm-sales", "oauth2", "edge", "edge-agent"),
  d("dynamics-crm", "Microsoft Dynamics 365 Sales", "crm-sales", "oauth2", "edge", "edge-agent"),

  // Marketing and web analytics
  d(
    "google-analytics-4",
    "Google Analytics 4",
    "marketing-web-analytics",
    "oauth2",
    "edge",
    "edge-agent",
  ),
  d(
    "google-search-console",
    "Google Search Console",
    "marketing-web-analytics",
    "oauth2",
    "edge",
    "edge-agent",
  ),
  d("google-ads", "Google Ads", "marketing-web-analytics", "oauth2", "edge", "edge-agent"),
  d("meta-ads", "Meta Ads", "marketing-web-analytics", "oauth2", "edge", "edge-agent"),
  d("linkedin-ads", "LinkedIn Ads", "marketing-web-analytics", "oauth2", "edge", "edge-agent"),
  d(
    "hubspot-marketing",
    "HubSpot Marketing",
    "marketing-web-analytics",
    "oauth2",
    "edge",
    "edge-agent",
  ),
  d("marketo", "Adobe Marketo Engage", "marketing-web-analytics", "oauth2", "edge", "edge-agent"),

  // Commerce, POS and inventory
  d("shopify", "Shopify", "commerce-pos-inventory", "oauth2", "edge", "edge-agent"),
  d("square", "Square", "commerce-pos-inventory", "oauth2", "edge", "edge-agent"),
  d("lightspeed", "Lightspeed", "commerce-pos-inventory", "oauth2", "edge", "edge-agent"),
  d("cin7", "Cin7", "commerce-pos-inventory", "apiKey", "edge", "edge-agent"),

  // Supply chain and logistics
  d("shipstation", "ShipStation", "supply-chain-logistics", "apiKey", "edge", "edge-agent"),
  d("flexport", "Flexport", "supply-chain-logistics", "apiKey", "edge", "edge-agent"),
  d("edi-sftp-feed", "EDI or SFTP feed", "supply-chain-logistics", "file", "edge", "file-edge"),

  // HRIS and ATS
  d("workday", "Workday", "hris-ats", "oauth2", "boundary", "boundary-runtime"),
  d("bamboohr", "BambooHR", "hris-ats", "apiKey", "edge", "edge-agent"),
  d("gusto", "Gusto", "hris-ats", "oauth2", "edge", "edge-agent"),
  d("rippling", "Rippling", "hris-ats", "oauth2", "edge", "edge-agent"),
  d("greenhouse", "Greenhouse", "hris-ats", "apiKey", "edge", "edge-agent"),
  d("lever", "Lever", "hris-ats", "oauth2", "edge", "edge-agent"),

  // Contracts and documents
  d("docusign", "DocuSign", "contracts-documents", "oauth2", "edge", "edge-agent"),
  d("ironclad-clm", "Ironclad CLM", "contracts-documents", "oauth2", "edge", "edge-agent"),
  d("google-drive", "Google Drive", "contracts-documents", "oauth2", "edge", "edge-agent"),
  d("sharepoint", "Microsoft SharePoint", "contracts-documents", "oauth2", "edge", "edge-agent"),
  d("box", "Box", "contracts-documents", "oauth2", "edge", "edge-agent"),

  // Support and customer
  d("zendesk", "Zendesk", "support-customer", "oauth2", "edge", "edge-agent"),
  d("intercom", "Intercom", "support-customer", "oauth2", "edge", "edge-agent"),
  d("gainsight", "Gainsight", "support-customer", "apiKey", "edge", "edge-agent"),

  // Reputation and social
  d("g2", "G2", "reputation-social", "apiKey", "edge", "edge-agent"),
  d("trustpilot", "Trustpilot", "reputation-social", "apiKey", "edge", "edge-agent"),
  d("google-reviews", "Google Reviews", "reputation-social", "oauth2", "edge", "edge-agent"),
  d("social-listening", "Social listening", "reputation-social", "apiKey", "edge", "edge-agent"),

  // Warehouse and BI (the bring-your-own-warehouse path)
  d("snowflake", "Snowflake", "warehouse-bi", "warehouseCredential", "boundary", "boundary-runtime"),
  d(
    "bigquery",
    "Google BigQuery",
    "warehouse-bi",
    "warehouseCredential",
    "boundary",
    "boundary-runtime",
  ),
  d(
    "databricks",
    "Databricks",
    "warehouse-bi",
    "warehouseCredential",
    "boundary",
    "boundary-runtime",
  ),
  d("redshift", "Amazon Redshift", "warehouse-bi", "warehouseCredential", "boundary", "boundary-runtime", {
    implemented: true,
  }),
  d(
    "generic-sql",
    "Generic SQL warehouse",
    "warehouse-bi",
    "warehouseCredential",
    "boundary",
    "boundary-runtime",
    { implemented: true },
  ),
];

export function getDescriptor(key: string): ConnectorDescriptor | undefined {
  return CATALOGUE.find((c) => c.key === key);
}
