# CANONICAL LAYER CONTENT SPECIFICATION
## Different Day · Elevated Intelligence · What Each Layer Shows and the Gaps It Exposes

This is the prescriptive content blueprint for the 14 canonical layers. It feeds two phases of the build: Phase E, the world-class seed data, which must populate every field below for every demo tenant, and Phase F, the archetype morph, which decides how each layer renders. Treat it as the spec, not a suggestion.

Two rules apply to every field of every layer, from the decisions already made:

- **Confidence throughout.** Every metric, root cause, action, and gap carries its own confidence value and a basis of verified or modelled. Verified means web-grounded or, in connected mode, derived from the client's own data. Modelled means analyst inference. Nothing is presented as fact without its basis.
- **Same skin, different bones.** The chrome, the analyst's take line, the confidence pills, and the "How this was reasoned" strip are identical across all 14 layers. Only the hero visualization and the emphasis morph by function, per the archetype assigned below.

### The per-layer template

Every layer is specified with the same eight fields: the executive owner, the archetype and hero, the four tiles a business person wants at a glance, the diagnostic focus, the root causes it surfaces, the prescriptive actions, the gaps it identifies in the client's own operation with the Different Day capability that closes each, and the data feeds that power it.

The gaps field is the point of the product. Every other system reports what happened. This layer reports what is missing in the client's own stack that made the answer uncertain or the problem possible, and what closes it. Be specific there.

---

## 1 · BUSINESS PERFORMANCE

- **Owner:** CEO and the board. This is the synthesizing layer that the other thirteen roll up into.
- **Archetype and hero:** Performance scorecard. Hero is a KPI scorecard with trend sparklines and a peer benchmark band, plus a one-line attribution of the headline gap to the layers driving it.
- **Four tiles:** revenue versus plan with variance, EBITDA or operating margin versus prior period, a growth-efficiency measure such as Rule of 40, and cash position with runway.
- **Diagnostic focus:** Is the business on plan, and if not, which layer is dragging it. This layer attributes the headline miss to its contributing layers rather than restating it.
- **Root causes:** surfaced by attribution, for example most of the revenue gap tracing to demand variance in two channels and to pricing leakage.
- **Actions:** the top three cross-layer levers ranked by their effect on the headline number, each linking to the layer that owns it.
- **Gaps identified:** no single source of truth across functions, so the headline number cannot be decomposed; no closed loop between plan and actuals; no early warning on the few metrics that actually move the headline. Closed by a unified performance-intelligence capability.
- **Feeds:** data warehouse or BI, accounting and ERP, CRM rollups.

---

## 2 · FINANCE

- **Owner:** CFO.
- **Archetype and hero:** Financial bridge. Hero is a plan-to-actual variance waterfall on the P&L, with a cash-position trend beneath it.
- **Four tiles:** gross margin percent, operating cash flow, cash conversion cycle or working capital, and free cash flow or burn.
- **Diagnostic focus:** where margin is leaking and where cash is trapped.
- **Root causes:** COGS drift, opex creep above plan, revenue mix shifting to lower margin, working-capital drag.
- **Actions:** named cost and working-capital levers sized to the gap, for example releasing cash from a specific inventory or receivables position.
- **Gaps identified:** the monthly close lags too far to act on; there is no driver-based forecast, only a static budget; cost visibility stops at the department line and never reaches the driver. Closed by a driver-based financial-intelligence capability.
- **Feeds:** accounting and ERP, data warehouse.

---

## 3 · DEMAND INTELLIGENCE

- **Owner:** CRO and CMO.
- **Archetype and hero:** Flow and funnel. Hero is a demand curve by channel with a seasonality overlay, showing captured versus latent demand.
- **Four tiles:** total addressable demand versus captured, demand by channel, a demand trend and seasonality index, and conversion of demand into qualified pipeline.
- **Diagnostic focus:** whether demand is the constraint or whether capture is the constraint.
- **Root causes:** channel concentration, latent demand left uncaptured, seasonality mismanaged against capacity.
- **Actions:** reallocate toward underweight channels, capture named latent segments, align capacity to the demand curve.
- **Gaps identified:** demand is reactive, not sensed ahead; channel data is siloed across platforms; there is no link between the demand signal and capacity or inventory. Closed by a demand-sensing capability.
- **Feeds:** GA4, Search Console, ad platforms, CRM, commerce.

---

## 4 · COMPETITIVE INTELLIGENCE

- **Owner:** CEO and strategy.
- **Archetype and hero:** Performance scorecard, benchmark variant. Hero is a competitor positioning matrix with a share-of-voice and share-of-market trend.
- **Four tiles:** relative market share and its trend, win rate versus named competitors, price position versus the market, and a positioning or feature gap index.
- **Diagnostic focus:** where you are losing and to whom.
- **Root causes:** positioning drift, a price disadvantage, capability gaps against a specific rival, share-of-voice deficit.
- **Actions:** targeted competitive plays against the rival taking share, repositioning where the matrix shows you crowded.
- **Gaps identified:** win and loss reasons are anecdotal, never captured structurally; competitive intelligence lives in people's heads; there is no early signal on competitor moves. Closed by a structured competitive-intelligence capability.
- **Feeds:** web and search, review sites, CRM win-loss, news.

---

## 5 · CUSTOMER INTELLIGENCE

- **Owner:** CRO and chief customer officer.
- **Archetype and hero:** Distribution and sentiment. Hero is a segment value distribution with retention cohort curves.
- **Four tiles:** net revenue retention, logo and revenue churn, customer lifetime value by segment, and concentration risk as the top-N customer share of revenue.
- **Diagnostic focus:** who your best customers are, who is at risk, and how dangerously concentrated the base is.
- **Root causes:** named churn drivers, high-value segments that are under-served, revenue concentration in a few accounts.
- **Actions:** retention plays on at-risk high-value accounts, expansion into the best-performing segment, deconcentration where one account is too large a share.
- **Gaps identified:** no unified customer view across CRM, support, and billing; no churn early warning; lifetime value is not measured, so acquisition spend is flying blind. Closed by a customer-360 and churn-prediction capability.
- **Feeds:** CRM, support, billing and commerce.

---

## 6 · BRAND AND SOCIAL

- **Owner:** CMO.
- **Archetype and hero:** Distribution and sentiment. Hero is a sentiment distribution with share of voice versus competitors.
- **Four tiles:** net sentiment, share of voice, review volume with average rating, and sentiment momentum.
- **Diagnostic focus:** how the brand is perceived and trending, and where reputation risk is building.
- **Root causes:** clusters of negative themes, declining share of voice against a rival, neglected review channels.
- **Actions:** address the top negative theme directly, share-of-voice plays where you are quiet, a review-response program.
- **Gaps identified:** no social listening, so perception is found out late; reputation is managed reactively after damage; brand perception is never linked to revenue. Closed by a brand-intelligence and listening capability.
- **Feeds:** review platforms, social listening, search.

---

## 7 · SUPPLY CHAIN

- **Owner:** COO.
- **Archetype and hero:** Network flow map. Hero is a node-and-edge flow map with a bottleneck highlight and a lead-time overlay.
- **Four tiles:** on-time-in-full, inventory turns or days of inventory, lead-time variance, and fill rate or stockout rate.
- **Diagnostic focus:** where the bottlenecks are and where working capital is trapped in inventory.
- **Root causes:** supplier reliability, inventory imbalanced against demand, lead-time variance, single-source dependency on a critical node.
- **Actions:** dual-source the critical single-supplier node, rebalance inventory off slow movers, buffer the high-variance lead time.
- **Gaps identified:** no end-to-end supply visibility, only point views; the operation reacts to disruption rather than anticipating it; inventory is not optimized against the demand signal. Closed by a supply-chain visibility and optimization capability.
- **Feeds:** ERP and inventory, logistics, EDI or SFTP feeds.

---

## 8 · PRICING AND MARGIN

- **Owner:** CFO and CRO.
- **Archetype and hero:** Financial bridge. Hero is a price-volume-mix bridge with a margin walk.
- **Four tiles:** realized versus list price showing discount leakage, margin by product or segment, the price-volume-mix contribution to the period, and an elasticity estimate.
- **Diagnostic focus:** where margin is given away and where pricing power is sitting unused.
- **Root causes:** discount leakage from discretionary discounting, mix shifting to low-margin lines, underpriced segments, no elasticity insight.
- **Actions:** tighten discounting on the leaking segment, reprice the underpriced segment, manage mix toward margin.
- **Gaps identified:** no price governance, so discounting is discretionary and invisible; margin is not visible at the transaction level; pricing is set by gut, not data. Closed by a pricing-intelligence and governance capability.
- **Feeds:** ERP, CRM quotes, commerce and POS.

---

## 9 · SALES PIPELINE

- **Owner:** CRO and VP Sales.
- **Archetype and hero:** Flow and funnel. Hero is a stage funnel showing conversion and the leakage points, with deal velocity.
- **Four tiles:** pipeline coverage ratio against target, stage-to-stage conversion rates, sales cycle length and velocity, and win rate with slippage.
- **Diagnostic focus:** whether there is enough pipeline, where it leaks, and whether it is moving.
- **Root causes:** coverage shortfall against the number, leakage at a specific stage, slow velocity, forecast inaccuracy.
- **Actions:** fix the stage that is leaking, coverage actions where pipeline is thin, velocity plays on stuck deals.
- **Gaps identified:** CRM hygiene is broken, with missing owners, missing values, and missing close dates, so the pipeline cannot be trusted; there is no closed-loop tracking of forecast accuracy; stage conversion is never benchmarked. Closed by a pipeline-intelligence and CRM-hygiene capability.
- **Feeds:** CRM.

---

## 10 · MARKETING PERFORMANCE

- **Owner:** CMO.
- **Archetype and hero:** Performance scorecard. Hero is a channel ROI scorecard with funnel efficiency and attribution.
- **Four tiles:** blended CAC and CAC by channel, LTV to CAC ratio, marketing-sourced pipeline share, and channel ROI or ROAS.
- **Diagnostic focus:** which channels pay and where spend is wasted.
- **Root causes:** inefficient channels still funded, attribution blind spots, funnel drop-off at a named stage.
- **Actions:** reallocate spend from the underperforming channel, fix the funnel stage that drops, kill the channel that does not pay.
- **Gaps identified:** no multi-touch attribution, so spend decisions rest on last-click or instinct; the marketing-to-revenue loop is not closed; channel data is fragmented. Closed by a marketing-attribution and efficiency capability.
- **Feeds:** GA4, ad platforms, CRM, marketing automation.

---

## 11 · PEOPLE OPERATIONS

- **Owner:** COO and CHRO. This is the org-efficiency lens: structure, cost, and productivity. It is distinct from Talent and HR, which is the people-lifecycle lens.
- **Archetype and hero:** Cohort and people. Hero is an org cohort view with a productivity and cost overlay.
- **Four tiles:** revenue per FTE, span of control and number of management layers, people-cost ratio, and a productivity trend.
- **Diagnostic focus:** whether the organization is efficient and where it is over or under-resourced relative to value.
- **Root causes:** management-layer bloat, low span of control, productivity drag in a function, headcount misallocated away from value.
- **Actions:** delayer where spans are narrow, rebalance headcount toward the value-creating functions.
- **Gaps identified:** no workforce analytics; headcount planning is disconnected from the financial plan; productivity is asserted, not measured. Closed by a workforce-intelligence capability.
- **Feeds:** HRIS, ERP and finance.

---

## 12 · CONTRACT MANAGEMENT

- **Owner:** CFO, general counsel, and COO.
- **Archetype and hero:** Timeline and risk. Hero is a renewal and expiry timeline with value at risk plotted across the horizon.
- **Four tiles:** contract value at risk in the next 90 and 180 days, auto-renew exposure, renewal rate, and off-contract or maverick spend.
- **Diagnostic focus:** what is expiring, what auto-renews on unfavorable terms, and where commercial leakage hides.
- **Root causes:** renewals reached without preparation, auto-renew traps, spend happening off-contract, obligations and terms untracked.
- **Actions:** renegotiate the high-value contract before it expires, cancel the unfavorable auto-renew before the window closes, bring maverick spend on-contract.
- **Gaps identified:** contracts live in filing cabinets and email, not a system; there is no renewal early warning; obligations are not tracked, so value and risk are both invisible. Closed by a contract-intelligence capability.
- **Feeds:** CLM, document stores, ERP spend.

---

## 13 · RECEIVABLES

- **Owner:** CFO and controller.
- **Archetype and hero:** Aging and collection. Hero is an aging-bucket view with a DSO trend and risk-weighted balances.
- **Four tiles:** DSO against terms, aging buckets of current, 30, 60, and 90-plus days, AR at risk with bad-debt exposure, and a collection effectiveness index.
- **Diagnostic focus:** where cash is trapped and what is at risk of not being collected.
- **Root causes:** slow collections, specific customers' payment behavior, a dispute backlog freezing balances, terms that are too generous.
- **Actions:** prioritize the high-value overdue accounts, tighten terms on chronic late payers, clear the dispute backlog.
- **Gaps identified:** collections are reactive and manual; there is no risk-based prioritization of who to chase; the cash forecast is not linked to the AR position. Closed by a receivables-intelligence and collections capability.
- **Feeds:** accounting and ERP, commerce.

---

## 14 · TALENT AND HR

- **Owner:** CHRO. This is the people-lifecycle lens: attrition, hiring, and compensation. It is distinct from People Operations, which is the org-efficiency lens.
- **Archetype and hero:** Cohort and people. Hero is an attrition cohort with a tenure distribution and the hiring funnel.
- **Four tiles:** regretted attrition rate, time-to-fill and hiring funnel health, compensation competitiveness with any pay-equity flag, and a tenure and flight-risk distribution.
- **Diagnostic focus:** who is leaving and why, and whether you can hire fast enough to keep up.
- **Root causes:** attrition concentrated in key roles or under one manager, slow hiring at a named funnel stage, compensation lagging the market.
- **Actions:** retention on the flight-risk key roles, fix the hiring funnel stage that stalls, address the comp lag where it drives exits.
- **Gaps identified:** no attrition prediction, so departures are a surprise; exit data is collected and never analyzed; compensation is not benchmarked, so pay drifts off market. Closed by a talent-intelligence capability.
- **Feeds:** HRIS, ATS.

---

## HOW THE GAPS ROLL UP

The per-layer gaps are not fourteen disconnected findings. They roll up into a small set of Different Day capability modules, which is what the "Powered by" callouts in the build reference. Map the layers to roughly eight modules so a client sees a coherent set of capabilities, not a scattered list:

- Performance and financial intelligence: business-performance, finance.
- Pricing and receivables intelligence: pricing-margin, receivables.
- Demand and marketing intelligence: demand-intelligence, marketing-performance.
- Revenue and customer intelligence: sales-pipeline, customer-intelligence.
- Competitive and brand intelligence: competitive-intelligence, brand-social.
- Supply and operations intelligence: supply-chain.
- Workforce and talent intelligence: people-operations, talent-hr.
- Contract and commercial intelligence: contract-management.

Wire the real Different Day module names onto these groups in the build, and let the cross-layer dependency map show how a gap in one layer propagates, for example how broken CRM hygiene in sales-pipeline degrades the confidence of the demand, customer, and marketing layers at once. That propagation is the strongest argument for buying the platform rather than a point tool: the gaps compound, and so does closing them.
