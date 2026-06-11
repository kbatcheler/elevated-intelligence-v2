# MASTER BUILD PROMPT · V2 DIFFERENTIATION AND MOAT
## Different Day · Elevated Intelligence · The Features That Make It a Platform, Not a Report

This is the fourth and final build prompt, after the V2 Master Build Prompt (A to G), the Data Connectors and SOC 2 addendum (H to M), and the Operations and Hardening prompt (N to V). Those three build a brilliant diagnostic engine. This one adds the layer that turns a brilliant diagnosis into a defensible platform with a sales motion: it grades its own advice, it gets smarter with scale, it serves a portfolio, it comes to you, and it argues back.

Read the three prior prompts and the Autonomous Execution and Drift Control Protocol first. Everything holds: the gates, the regression contract, the three-model cortex, the derive-and-discard principle, and the em-dash ban. Never use a long em-dash anywhere.

**Why these run last.** Each feature here depends on something built earlier: the outcome loop builds on committed actions and the confidence model, benchmarking builds on the connectors' derived signals, the portfolio view builds on the org and role model from Phase T, proactive push builds on the notification sink from Phase P, and interactive challenge builds on the Confounder from Phase B. So this set runs after Phase V, as Phases W through AC. Execute them under the autonomous protocol, gated, with a drift report each.

---

## W · OUTCOME LOOP AND VALUE REALIZED (the trust and renewal engine)

A system that grades its own prescriptions is one a CEO believes, and the value-realized number is the single strongest renewal and expansion argument you have. Build it.

- **Capture the prediction.** Every recommended action already carries a predicted recovery from the layer content spec. When a user commits an action (committed actions exist today), snapshot the prediction and the baseline metric at that moment: `predictedValueUsd`, `baselineMetric`, `baselineAt`.
- **Measure the actual.** Add `outcome_measurements`: `id`, `actionId`, `measuredAt`, `actualMetric`, `realizedValueUsd`, `varianceVsPrediction`, `status` (pending, on-track, realized, missed). In connected mode the actual is measured from the tenant's real derived signals over time. In outside-in or modelled mode it is an estimate, marked with basis modelled, never presented as measured fact.
- **The counter.** On the business-performance layer, a hero showing cumulative value identified (sum of predicted recovery across surfaced actions) versus value realized (sum of measured realized value). This is the number the CFO renews on.
- **Grade the system.** Compute a prediction-accuracy or calibration score over time: how close the system's predicted recoveries came to actual. Show it as a trust badge. A system willing to be scored on its own advice is the differentiator. Do not hide misses, surface them, because honest calibration is what builds belief.
- **Elevate, do not replace.** The existing track record and committed-actions surfaces are the foundation. Extend them, keep them working.

Acceptance: committing an action snapshots a prediction baseline, a measurement records realized value with the correct basis, the value-identified-versus-realized counter reconciles against a manual sum, and the calibration score computes and updates as outcomes land.

---

## X · BENCHMARKING AND THE DATA NETWORK EFFECT (the moat)

This is the biggest differentiator and the one strategic tension in the whole product. The network effect needs cross-client data density. The security moat is derive and discard. They coexist only if you build the privacy in from the first line, so do exactly this and nothing looser.

- **Built from derived signals only.** Benchmarks are computed from the aggregated, non-reversible `derived_signals` across opted-in tenants. No raw data, ever. No tenant identity, ever. A benchmark is a distribution statistic over a cohort, not a comparison to named companies.
- **Opt-in, default off.** A tenant must explicitly opt in to contribute to and receive cohort benchmarks. Consent is logged. Opting out removes their contribution from future computations. Default is off.
- **k-anonymity threshold, hard.** No benchmark renders for a cohort unless it contains at least a minimum number of contributing tenants, default 5. Below the threshold the UI shows "benchmark unlocks at N companies in your segment," which doubles as the network-effect hook. For small cohorts near the threshold, add distribution-noise so no single contributor can be reverse-engineered from a shift in the stats.
- **Cohorts by segment.** Define a cohort as industry plus revenue band, using the ICP bands. Store `benchmark_cohorts` (segment key, member count) and `benchmark_stats` (cohort, layer, metric, p25, p50, p75, computed-at), with no tenant references in the stats table at all.
- **Flip the tiles.** Each layer's peer benchmark tile switches from modelled to real-cohort when density allows, marked with basis verified-cohort and the cohort size, so the user knows it is real peers, not an estimate.

Acceptance: a benchmark never renders below the k-anonymity threshold; no query or table join can reverse a benchmark stat to a contributing tenant; opting out removes contribution from the next computation; every benchmark tile shows its basis and cohort size; and the consent state is logged. The drift report for this phase must explicitly affirm that no raw data and no tenant identity enters the benchmark path.

---

## Y · PORTFOLIO INTELLIGENCE VIEW (the go-to-market unlock)

This changes the sales motion: sell once to an investor or portfolio operator, deploy across every company they touch. It builds on the org and role model from Phase T.

- **Portfolio org type.** Extend orgs so a portfolio org can be bound to many tenants. A portfolio user sees only their bound tenants, never anyone else's, the access scoping from Phase T still applies in full.
- **The ranked view.** A portfolio dashboard that ranks the bound tenants by the metrics an operator cares about: value at risk, value identified versus realized, overall confidence, and the count and severity of open gaps. The worst and best performers surface to the top.
- **Cross-portfolio patterns.** Aggregate across the portfolio and name the common gaps, for example "6 of your 9 companies have broken CRM hygiene in the sales-pipeline layer" or "pricing leakage is the most common margin gap across the portfolio." This is the insight no single-company tool can produce and is the reason an investor buys the platform, not a seat.
- **Drill down.** From any tenant in the ranking, drill into that tenant's full diagnosis, unchanged.

Acceptance: a portfolio user sees a ranked multi-tenant view, sees cross-portfolio gap patterns, can drill into any bound tenant's full diagnosis, and gets 403 on any tenant outside their portfolio.

---

## Z · PROACTIVE PUSH INTELLIGENCE (the daily habit)

An intelligence product that waits to be opened is a quarterly report. One that comes to you is a habit, and habit is retention. Build on the notification sink from Phase P, but this is business intelligence pushed to the user, not ops alerts.

- **Alert rules.** Add `alert_rules` (tenant or org, user, layer, condition, threshold, channel, enabled) and `alert_events` (rule, fired-at, payload reference, delivered). Conditions are material changes: a metric crossing a confidence or performance band, a new high-confidence finding, a new gap surfaced, a competitor move detected.
- **The delivered digest.** A scheduled Morning Brief delivered to email or Slack, not only in-app, ranked by impact, carrying only material changes. Configurable cadence per user.
- **Smart, not noisy.** Suppress low-impact noise. Rank by predicted dollar impact and confidence. A user can tune thresholds or mute a layer. Noise is the fastest way to lose the habit, so default to fewer, higher-signal pushes.
- **In-app center.** A notification center mirroring what was pushed.

Acceptance: a material threshold breach generates a ranked digest delivered to the chosen channel, low-impact changes are suppressed, and a user can tune or mute without losing the high-signal ones.

---

## AA · INTERACTIVE CHALLENGE (the living analyst)

This is where the Confounder pays off in the experience, not just the backend. A user can push back on any finding and watch the system re-reason. It makes the product feel like an analyst you can argue with, not a static report.

- **Challenge a finding.** On any finding, root cause, or metric, a "challenge this" action lets the user add context: "this is seasonal," "that number looks wrong," "we changed this last quarter."
- **Re-reason, do not rubber-stamp.** The challenge routes to the Confounder and Synthesist. The system re-evaluates with the new input and either upholds the finding with its reasoning, or revises it with a new confidence and a note that user input changed it. User input is weighed as context, it is not an override. A user cannot simply delete an inconvenient finding, the Confounder evaluates the challenge on its merits.
- **Auditable.** Add `finding_challenges` (finding reference, user, challenge text, created-at, response, outcome of upheld or revised, revised confidence). When a finding is revised by user input, its basis becomes modelled, user-informed, so the change is visible and never a silent overwrite. This keeps the provenance honest.
- **Extends, does not replace, Ask Different Day.** The existing chat stays. This adds finding-level dialogue on top.

Acceptance: a challenge re-runs the relevant reasoning, the response either upholds with reasoning or revises with a new confidence, user input cannot unilaterally delete a finding, and every exchange is logged and auditable with the revised basis shown.

---

## AB · SELLABILITY PACK (the fast-follows that make it move)

Bundle the lighter features that make the product easy to sell. Each is small on its own and worth shipping together.

- **Instant self-serve diagnosis.** Productize the outside-in path as the top of the funnel: a prospect enters their own company URL and gets a real diagnosis fast, using express seed from Phase D for speed, with a handful of real gaps exposed. Add a shareable, read-only diagnosis link with the privacy controls to match, so the demo spreads on its own. This is the moment that sells, do not let it be slow or gated.
- **Auto-generated case studies.** From the outcome data in Phase W, generate anonymized "a company like yours recovered X" narratives for sales collateral. They must respect the same k-anonymity and no-identity rules as benchmarking.
- **Board pack virality.** The export-to-PDF board pack from Phase F gets a tasteful "powered by Different Day" mark and a single clear path for a board member who sees it to get it for their own company. Board members are your distribution.
- **Editorial voice bar.** Codify the Synthesist voice as a quality standard: strategist-grade, conviction-led, specific, no hedging, no LLM tells, no filler. Add a voice-quality check to the narrate stage and to the drift report. The prose is the product, a diagnosis that reads like a brilliant strategist wrote it is the difference between a tool and an oracle.

Acceptance: a cold URL yields a shareable diagnosis quickly, a case study generates from real outcome data without exposing identity, the board pack carries the viral hook, and the narrative meets the codified voice bar with the drift report confirming it.

---

## AC · VERIFICATION AND BUILD REPORT

1. `pnpm run typecheck`, `pnpm run build`, and the test suite pass in CI.
2. The value-identified-versus-realized counter reconciles, and the calibration score computes including misses.
3. Benchmarks never render below the k-anonymity threshold, cannot be reversed to a tenant, and respect opt-out. The drift report affirms no raw data and no identity in the benchmark path.
4. A portfolio user sees a ranked, cross-pattern multi-tenant view and is fenced to their own portfolio.
5. A material change pushes a ranked digest to the chosen channel, with noise suppressed.
6. A challenged finding re-reasons and either upholds or revises with a new confidence, logged and auditable, with user input unable to delete a finding.
7. The instant diagnosis is fast and shareable, case studies generate without exposing identity, and the voice bar is met.
8. The full regression contract still holds and em-dash sweep is zero.
9. Append to `docs/build-report-v2.md`: the new tables and routes, the benchmarking privacy design and its thresholds, the portfolio model, the alert model, and the challenge and outcome schemas.

---

## EXECUTION ORDER (gates, continuing from the operations prompt)

- **Phase W.** Outcome loop and value realized.
- **Phase X.** Benchmarking and the data network effect. This is a security-sensitive phase, mark it as a milestone in the drift index per the protocol.
- **Phase Y.** Portfolio intelligence view.
- **Phase Z.** Proactive push intelligence.
- **Phase AA.** Interactive challenge.
- **Phase AB.** Sellability pack.
- **Phase AC.** Full verification and the build-report append.

Begin with Phase W. Do not proceed past any gate without satisfying it. Build the benchmarking privacy in from the first line, because it is the one place where getting it wrong breaks the trust the whole product is built on.
