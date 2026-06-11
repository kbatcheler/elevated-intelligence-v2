import type { InsertLayer } from "../schema/layers";

// The 14 canonical layers, transcribed from the Canonical Layer Content
// Specification. This is seed data for the registry, not a constant the code
// branches on: the system reads layer identity from the layers table at
// runtime. Keep this faithful to the specification.
export const CANONICAL_LAYERS: InsertLayer[] = [
  {
    key: "business-performance",
    name: "Business Performance",
    description:
      "The synthesizing layer the other thirteen roll up into. It attributes the headline miss to the layers driving it rather than restating it.",
    archetype: "Performance scorecard",
    heroDescription:
      "A KPI scorecard with trend sparklines and a peer benchmark band, plus a one-line attribution of the headline gap to the layers driving it.",
    ownerPersona: "CEO and the board",
    diagnosticQuestion: "Is the business on plan, and if not, which layer is dragging it.",
    metricDefinitions: {
      tiles: [
        "Revenue versus plan with variance",
        "EBITDA or operating margin versus prior period",
        "A growth-efficiency measure such as Rule of 40",
        "Cash position with runway",
      ],
    },
    rootCauses: [
      "Most of the revenue gap tracing to demand variance in two channels",
      "Pricing leakage",
      "Drag from a specific contributing layer",
    ],
    actions: [
      "Pull the top three cross-layer levers ranked by their effect on the headline number",
      "Link each lever to the layer that owns it",
    ],
    gaps: {
      items: [
        "No single source of truth across functions, so the headline number cannot be decomposed",
        "No closed loop between plan and actuals",
        "No early warning on the few metrics that actually move the headline",
      ],
      closedBy: "a unified performance-intelligence capability",
    },
    feeds: ["Data warehouse or BI", "Accounting and ERP", "CRM rollups"],
    moduleGroup: "Performance and financial intelligence",
    isCanonical: true,
    sortOrder: 1,
  },
  {
    key: "finance",
    name: "Finance",
    description: "Where margin is leaking and where cash is trapped.",
    archetype: "Financial bridge",
    heroDescription:
      "A plan-to-actual variance waterfall on the P&L, with a cash-position trend beneath it.",
    ownerPersona: "CFO",
    diagnosticQuestion: "Where is margin leaking and where is cash trapped.",
    metricDefinitions: {
      tiles: [
        "Gross margin percent",
        "Operating cash flow",
        "Cash conversion cycle or working capital",
        "Free cash flow or burn",
      ],
    },
    rootCauses: [
      "COGS drift",
      "Opex creep above plan",
      "Revenue mix shifting to lower margin",
      "Working-capital drag",
    ],
    actions: [
      "Pull named cost and working-capital levers sized to the gap",
      "Release cash from a specific inventory or receivables position",
    ],
    gaps: {
      items: [
        "The monthly close lags too far to act on",
        "There is no driver-based forecast, only a static budget",
        "Cost visibility stops at the department line and never reaches the driver",
      ],
      closedBy: "a driver-based financial-intelligence capability",
    },
    feeds: ["Accounting and ERP", "Data warehouse"],
    moduleGroup: "Performance and financial intelligence",
    isCanonical: true,
    sortOrder: 2,
  },
  {
    key: "demand-intelligence",
    name: "Demand Intelligence",
    description: "Whether demand is the constraint or whether capture is the constraint.",
    archetype: "Flow and funnel",
    heroDescription:
      "A demand curve by channel with a seasonality overlay, showing captured versus latent demand.",
    ownerPersona: "CRO and CMO",
    diagnosticQuestion: "Is demand the constraint, or is capture the constraint.",
    metricDefinitions: {
      tiles: [
        "Total addressable demand versus captured",
        "Demand by channel",
        "A demand trend and seasonality index",
        "Conversion of demand into qualified pipeline",
      ],
    },
    rootCauses: [
      "Channel concentration",
      "Latent demand left uncaptured",
      "Seasonality mismanaged against capacity",
    ],
    actions: [
      "Reallocate toward underweight channels",
      "Capture named latent segments",
      "Align capacity to the demand curve",
    ],
    gaps: {
      items: [
        "Demand is reactive, not sensed ahead",
        "Channel data is siloed across platforms",
        "There is no link between the demand signal and capacity or inventory",
      ],
      closedBy: "a demand-sensing capability",
    },
    feeds: ["GA4", "Search Console", "Ad platforms", "CRM", "Commerce"],
    moduleGroup: "Demand and marketing intelligence",
    isCanonical: true,
    sortOrder: 3,
  },
  {
    key: "competitive-intelligence",
    name: "Competitive Intelligence",
    description: "Where you are losing and to whom.",
    archetype: "Performance scorecard, benchmark variant",
    heroDescription:
      "A competitor positioning matrix with a share-of-voice and share-of-market trend.",
    ownerPersona: "CEO and strategy",
    diagnosticQuestion: "Where are you losing, and to whom.",
    metricDefinitions: {
      tiles: [
        "Relative market share and its trend",
        "Win rate versus named competitors",
        "Price position versus the market",
        "A positioning or feature gap index",
      ],
    },
    rootCauses: [
      "Positioning drift",
      "A price disadvantage",
      "Capability gaps against a specific rival",
      "Share-of-voice deficit",
    ],
    actions: [
      "Run targeted competitive plays against the rival taking share",
      "Reposition where the matrix shows you crowded",
    ],
    gaps: {
      items: [
        "Win and loss reasons are anecdotal, never captured structurally",
        "Competitive intelligence lives in people's heads",
        "There is no early signal on competitor moves",
      ],
      closedBy: "a structured competitive-intelligence capability",
    },
    feeds: ["Web and search", "Review sites", "CRM win-loss", "News"],
    moduleGroup: "Competitive and brand intelligence",
    isCanonical: true,
    sortOrder: 4,
  },
  {
    key: "customer-intelligence",
    name: "Customer Intelligence",
    description: "Who your best customers are, who is at risk, and how concentrated the base is.",
    archetype: "Distribution and sentiment",
    heroDescription: "A segment value distribution with retention cohort curves.",
    ownerPersona: "CRO and chief customer officer",
    diagnosticQuestion:
      "Who are your best customers, who is at risk, and how concentrated is the base.",
    metricDefinitions: {
      tiles: [
        "Net revenue retention",
        "Logo and revenue churn",
        "Customer lifetime value by segment",
        "Concentration risk as the top-N customer share of revenue",
      ],
    },
    rootCauses: [
      "Named churn drivers",
      "High-value segments that are under-served",
      "Revenue concentration in a few accounts",
    ],
    actions: [
      "Run retention plays on at-risk high-value accounts",
      "Expand into the best-performing segment",
      "Deconcentrate where one account is too large a share",
    ],
    gaps: {
      items: [
        "No unified customer view across CRM, support, and billing",
        "No churn early warning",
        "Lifetime value is not measured, so acquisition spend is flying blind",
      ],
      closedBy: "a customer-360 and churn-prediction capability",
    },
    feeds: ["CRM", "Support", "Billing and commerce"],
    moduleGroup: "Revenue and customer intelligence",
    isCanonical: true,
    sortOrder: 5,
  },
  {
    key: "brand-social",
    name: "Brand and Social",
    description: "How the brand is perceived and trending, and where reputation risk is building.",
    archetype: "Distribution and sentiment",
    heroDescription: "A sentiment distribution with share of voice versus competitors.",
    ownerPersona: "CMO",
    diagnosticQuestion:
      "How is the brand perceived and trending, and where is reputation risk building.",
    metricDefinitions: {
      tiles: [
        "Net sentiment",
        "Share of voice",
        "Review volume with average rating",
        "Sentiment momentum",
      ],
    },
    rootCauses: [
      "Clusters of negative themes",
      "Declining share of voice against a rival",
      "Neglected review channels",
    ],
    actions: [
      "Address the top negative theme directly",
      "Run share-of-voice plays where you are quiet",
      "Stand up a review-response program",
    ],
    gaps: {
      items: [
        "No social listening, so perception is found out late",
        "Reputation is managed reactively after damage",
        "Brand perception is never linked to revenue",
      ],
      closedBy: "a brand-intelligence and listening capability",
    },
    feeds: ["Review platforms", "Social listening", "Search"],
    moduleGroup: "Competitive and brand intelligence",
    isCanonical: true,
    sortOrder: 6,
  },
  {
    key: "supply-chain",
    name: "Supply Chain",
    description: "Where the bottlenecks are and where working capital is trapped in inventory.",
    archetype: "Network flow map",
    heroDescription: "A node-and-edge flow map with a bottleneck highlight and a lead-time overlay.",
    ownerPersona: "COO",
    diagnosticQuestion:
      "Where are the bottlenecks and where is working capital trapped in inventory.",
    metricDefinitions: {
      tiles: [
        "On-time-in-full",
        "Inventory turns or days of inventory",
        "Lead-time variance",
        "Fill rate or stockout rate",
      ],
    },
    rootCauses: [
      "Supplier reliability",
      "Inventory imbalanced against demand",
      "Lead-time variance",
      "Single-source dependency on a critical node",
    ],
    actions: [
      "Dual-source the critical single-supplier node",
      "Rebalance inventory off slow movers",
      "Buffer the high-variance lead time",
    ],
    gaps: {
      items: [
        "No end-to-end supply visibility, only point views",
        "The operation reacts to disruption rather than anticipating it",
        "Inventory is not optimized against the demand signal",
      ],
      closedBy: "a supply-chain visibility and optimization capability",
    },
    feeds: ["ERP and inventory", "Logistics", "EDI or SFTP feeds"],
    moduleGroup: "Supply and operations intelligence",
    isCanonical: true,
    sortOrder: 7,
  },
  {
    key: "pricing-margin",
    name: "Pricing and Margin",
    description: "Where margin is given away and where pricing power is sitting unused.",
    archetype: "Financial bridge",
    heroDescription: "A price-volume-mix bridge with a margin walk.",
    ownerPersona: "CFO and CRO",
    diagnosticQuestion: "Where is margin given away and where is pricing power sitting unused.",
    metricDefinitions: {
      tiles: [
        "Realized versus list price showing discount leakage",
        "Margin by product or segment",
        "The price-volume-mix contribution to the period",
        "An elasticity estimate",
      ],
    },
    rootCauses: [
      "Discount leakage from discretionary discounting",
      "Mix shifting to low-margin lines",
      "Underpriced segments",
      "No elasticity insight",
    ],
    actions: [
      "Tighten discounting on the leaking segment",
      "Reprice the underpriced segment",
      "Manage mix toward margin",
    ],
    gaps: {
      items: [
        "No price governance, so discounting is discretionary and invisible",
        "Margin is not visible at the transaction level",
        "Pricing is set by gut, not data",
      ],
      closedBy: "a pricing-intelligence and governance capability",
    },
    feeds: ["ERP", "CRM quotes", "Commerce and POS"],
    moduleGroup: "Pricing and receivables intelligence",
    isCanonical: true,
    sortOrder: 8,
  },
  {
    key: "sales-pipeline",
    name: "Sales Pipeline",
    description: "Whether there is enough pipeline, where it leaks, and whether it is moving.",
    archetype: "Flow and funnel",
    heroDescription:
      "A stage funnel showing conversion and the leakage points, with deal velocity.",
    ownerPersona: "CRO and VP Sales",
    diagnosticQuestion: "Is there enough pipeline, where does it leak, and is it moving.",
    metricDefinitions: {
      tiles: [
        "Pipeline coverage ratio against target",
        "Stage-to-stage conversion rates",
        "Sales cycle length and velocity",
        "Win rate with slippage",
      ],
    },
    rootCauses: [
      "Coverage shortfall against the number",
      "Leakage at a specific stage",
      "Slow velocity",
      "Forecast inaccuracy",
    ],
    actions: [
      "Fix the stage that is leaking",
      "Run coverage actions where pipeline is thin",
      "Run velocity plays on stuck deals",
    ],
    gaps: {
      items: [
        "CRM hygiene is broken, with missing owners, values, and close dates, so the pipeline cannot be trusted",
        "There is no closed-loop tracking of forecast accuracy",
        "Stage conversion is never benchmarked",
      ],
      closedBy: "a pipeline-intelligence and CRM-hygiene capability",
    },
    feeds: ["CRM"],
    moduleGroup: "Revenue and customer intelligence",
    isCanonical: true,
    sortOrder: 9,
  },
  {
    key: "marketing-performance",
    name: "Marketing Performance",
    description: "Which channels pay and where spend is wasted.",
    archetype: "Performance scorecard",
    heroDescription: "A channel ROI scorecard with funnel efficiency and attribution.",
    ownerPersona: "CMO",
    diagnosticQuestion: "Which channels pay, and where is spend wasted.",
    metricDefinitions: {
      tiles: [
        "Blended CAC and CAC by channel",
        "LTV to CAC ratio",
        "Marketing-sourced pipeline share",
        "Channel ROI or ROAS",
      ],
    },
    rootCauses: [
      "Inefficient channels still funded",
      "Attribution blind spots",
      "Funnel drop-off at a named stage",
    ],
    actions: [
      "Reallocate spend from the underperforming channel",
      "Fix the funnel stage that drops",
      "Kill the channel that does not pay",
    ],
    gaps: {
      items: [
        "No multi-touch attribution, so spend decisions rest on last-click or instinct",
        "The marketing-to-revenue loop is not closed",
        "Channel data is fragmented",
      ],
      closedBy: "a marketing-attribution and efficiency capability",
    },
    feeds: ["GA4", "Ad platforms", "CRM", "Marketing automation"],
    moduleGroup: "Demand and marketing intelligence",
    isCanonical: true,
    sortOrder: 10,
  },
  {
    key: "people-operations",
    name: "People Operations",
    description:
      "The org-efficiency lens: structure, cost, and productivity. Distinct from Talent and HR, the people-lifecycle lens.",
    archetype: "Cohort and people",
    heroDescription: "An org cohort view with a productivity and cost overlay.",
    ownerPersona: "COO and CHRO",
    diagnosticQuestion:
      "Is the organization efficient, and where is it over or under-resourced relative to value.",
    metricDefinitions: {
      tiles: [
        "Revenue per FTE",
        "Span of control and number of management layers",
        "People-cost ratio",
        "A productivity trend",
      ],
    },
    rootCauses: [
      "Management-layer bloat",
      "Low span of control",
      "Productivity drag in a function",
      "Headcount misallocated away from value",
    ],
    actions: [
      "Delayer where spans are narrow",
      "Rebalance headcount toward the value-creating functions",
    ],
    gaps: {
      items: [
        "No workforce analytics",
        "Headcount planning is disconnected from the financial plan",
        "Productivity is asserted, not measured",
      ],
      closedBy: "a workforce-intelligence capability",
    },
    feeds: ["HRIS", "ERP and finance"],
    moduleGroup: "Workforce and talent intelligence",
    isCanonical: true,
    sortOrder: 11,
  },
  {
    key: "contract-management",
    name: "Contract Management",
    description:
      "What is expiring, what auto-renews on unfavorable terms, and where commercial leakage hides.",
    archetype: "Timeline and risk",
    heroDescription:
      "A renewal and expiry timeline with value at risk plotted across the horizon.",
    ownerPersona: "CFO, general counsel, and COO",
    diagnosticQuestion:
      "What is expiring, what auto-renews on unfavorable terms, and where does commercial leakage hide.",
    metricDefinitions: {
      tiles: [
        "Contract value at risk in the next 90 and 180 days",
        "Auto-renew exposure",
        "Renewal rate",
        "Off-contract or maverick spend",
      ],
    },
    rootCauses: [
      "Renewals reached without preparation",
      "Auto-renew traps",
      "Spend happening off-contract",
      "Obligations and terms untracked",
    ],
    actions: [
      "Renegotiate the high-value contract before it expires",
      "Cancel the unfavorable auto-renew before the window closes",
      "Bring maverick spend on-contract",
    ],
    gaps: {
      items: [
        "Contracts live in filing cabinets and email, not a system",
        "There is no renewal early warning",
        "Obligations are not tracked, so value and risk are both invisible",
      ],
      closedBy: "a contract-intelligence capability",
    },
    feeds: ["CLM", "Document stores", "ERP spend"],
    moduleGroup: "Contract and commercial intelligence",
    isCanonical: true,
    sortOrder: 12,
  },
  {
    key: "receivables",
    name: "Receivables",
    description: "Where cash is trapped and what is at risk of not being collected.",
    archetype: "Aging and collection",
    heroDescription: "An aging-bucket view with a DSO trend and risk-weighted balances.",
    ownerPersona: "CFO and controller",
    diagnosticQuestion: "Where is cash trapped, and what is at risk of not being collected.",
    metricDefinitions: {
      tiles: [
        "DSO against terms",
        "Aging buckets of current, 30, 60, and 90-plus days",
        "AR at risk with bad-debt exposure",
        "A collection effectiveness index",
      ],
    },
    rootCauses: [
      "Slow collections",
      "Specific customers' payment behavior",
      "A dispute backlog freezing balances",
      "Terms that are too generous",
    ],
    actions: [
      "Prioritize the high-value overdue accounts",
      "Tighten terms on chronic late payers",
      "Clear the dispute backlog",
    ],
    gaps: {
      items: [
        "Collections are reactive and manual",
        "There is no risk-based prioritization of who to chase",
        "The cash forecast is not linked to the AR position",
      ],
      closedBy: "a receivables-intelligence and collections capability",
    },
    feeds: ["Accounting and ERP", "Commerce"],
    moduleGroup: "Pricing and receivables intelligence",
    isCanonical: true,
    sortOrder: 13,
  },
  {
    key: "talent-hr",
    name: "Talent and HR",
    description:
      "The people-lifecycle lens: attrition, hiring, and compensation. Distinct from People Operations, the org-efficiency lens.",
    archetype: "Cohort and people",
    heroDescription: "An attrition cohort with a tenure distribution and the hiring funnel.",
    ownerPersona: "CHRO",
    diagnosticQuestion: "Who is leaving and why, and can you hire fast enough to keep up.",
    metricDefinitions: {
      tiles: [
        "Regretted attrition rate",
        "Time-to-fill and hiring funnel health",
        "Compensation competitiveness with any pay-equity flag",
        "A tenure and flight-risk distribution",
      ],
    },
    rootCauses: [
      "Attrition concentrated in key roles or under one manager",
      "Slow hiring at a named funnel stage",
      "Compensation lagging the market",
    ],
    actions: [
      "Run retention on the flight-risk key roles",
      "Fix the hiring funnel stage that stalls",
      "Address the comp lag where it drives exits",
    ],
    gaps: {
      items: [
        "No attrition prediction, so departures are a surprise",
        "Exit data is collected and never analyzed",
        "Compensation is not benchmarked, so pay drifts off market",
      ],
      closedBy: "a talent-intelligence capability",
    },
    feeds: ["HRIS", "ATS"],
    moduleGroup: "Workforce and talent intelligence",
    isCanonical: true,
    sortOrder: 14,
  },
];
