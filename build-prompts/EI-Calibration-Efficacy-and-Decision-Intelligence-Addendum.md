# MASTER BUILD PROMPT · CALIBRATION, EFFICACY AND DECISION INTELLIGENCE ADDENDUM
## Different Day · Elevated Intelligence · The Trust Architecture Nobody Else Will Ship

This addendum extends the greenfield build with Phases AJ to AN, executed after Phase AI under the Autonomous Execution and Drift Control Protocol and the Greenfield Build Plan. The protocol's rules hold in full: per-phase gates, drift reports, tagged commits, no faked output, no em-dashes anywhere.

The strategic idea behind every phase here: the deepest differentiation available against Palantir and against every AI vendor is published, mathematically honest self-grading. Most intelligence products assert confidence. This one proves its calibration with a scoring rule, shows the efficacy of the data behind every layer, records the decisions taken on its advice, and can replay what it believed at any point in time. That is trust as architecture, and it is the thing a CEO repeats to another CEO.

---

## AJ · THE BRIER-SCORED CALIBRATION LEDGER (the system grades itself, publicly and properly)

Phase W built the outcome loop with a loose "calibration score." Replace that looseness with a proper probabilistic scoring system.

- **Forecasts become probabilistic and resolvable.** Every prediction the system makes that can resolve as true or false within a horizon (an action's predicted recovery materialising, a flagged risk occurring, an anomaly proving material, a finding surviving challenge) is stored as a forecast: `forecasts` table with statement, probability (0 to 1), madeAt, resolveBy, layerKey, tenantId, kind, and later resolvedAt and outcome. The Evaluator seat assigns the probability at creation; the prompt must instruct genuine probability estimation, not reflexive 0.8s.
- **Brier scoring on resolution.** When a forecast resolves (from outcome measurements in connected mode, or owner adjudication otherwise), compute its Brier score, the squared error between the stated probability and the 0-or-1 outcome. Maintain rolling Brier scores system-wide, per layer, per forecast kind, and per cortex seat, alongside a calibration curve (stated probability bands versus observed frequency) and the comparison baseline: the score a naive always-says-0.5 forecaster would achieve, so the number means something to a lay reader.
- **Exposed, not buried.** A Calibration page in the product: the headline Brier score with a plain-English explainer ("lower is better; 0.25 is coin-flip guessing; here is ours"), the calibration curve, per-layer scores, and the resolved-forecast count. Show the count prominently and never overclaim on thin data: below a minimum resolved sample per segment, label the score "early, n resolved" rather than presenting it as established. Misses are shown, never filtered. A system willing to publish its own Brier score is making a claim no dashboard vendor can copy without exposing themselves.
- **Score the Confounder too.** Confounder verdicts (ruled out, partial, unresolved) are themselves predictions about explanations. When later evidence resolves one, score it, so the adversarial seat carries its own published accuracy.
- **Wire it back into confidence.** Per-layer Brier performance feeds back into the Evaluator's confidence assignments as a calibration adjustment, so the confidence pills are not static claims but numbers disciplined by the system's own track record.

Acceptance: forecasts persist with probabilities; resolution computes Brier correctly (unit-tested against hand-worked examples); the Calibration page renders system, layer and seat scores with the curve, the naive baseline and honest sample-size labelling; a deliberately wrong forecast visibly worsens the score; the drift report affirms no filtering of misses.

## AK · THE DATA EFFICACY INDEX (per-layer, the answer to "how good is the data behind this")

Confidence says how sure the reasoning is. Efficacy says how good the fuel was. Make the second a first-class, per-layer instrument.

- **The index.** A 0-to-100 Data Efficacy Index per layer per tenant, computed from named drivers, each shown with its contribution: coverage (feeds present versus the layer's expected feed set from the registry), freshness (age of the newest signal versus the layer's cadence), verification rate (share of the layer's claims that are verified versus modelled), adversarial survival (share of confounders ruled out rather than unresolved), and source diversity (independent sources behind the diagnosis). Weights live in one config, documented.
- **Displayed where decisions happen.** The index sits beside the confidence band on every layer header, with a tooltip naming the drivers and the single cheapest improvement ("connect receivables data to lift efficacy 22 points"). That last part converts the index from a grade into a sales motion for connecting more data, which is the honest version of upsell: the system tells the client exactly what data would make it smarter, and by how much.
- **Modes differ honestly.** Outside-in tenants show structurally lower efficacy ceilings than connected tenants, and the index says why, which is itself the demo-to-pilot conversion argument rendered as a number.
- **Rolls up.** A tenant-level efficacy summary on the business-performance layer and in the Board Pack, and a portfolio-level efficacy ranking in the portfolio view, so an operating partner sees at a glance which companies are flying on thin data.

Acceptance: the index computes from real driver values per layer; the drivers and the cheapest-improvement hint render; connecting a new feed or resolving confounders moves the index; outside-in and connected tenants show honestly different profiles; weights are config, tested.

## AL · THE DECISION LEDGER AND THE PRE-MORTEM (decision intelligence, Palantir's actual product, sized for the mid-market)

What Palantir really sells is decision infrastructure: institutions act through it and the record of why survives. Build the mid-market version.

- **Decision records.** When a user commits, defers, or rejects a recommended action, capture a decision record: what was decided, by whom, when, the system's recommendation and confidence at that moment, the evidence snapshot (provenance references), the stated rationale if the user gives one, and the linked forecast from AJ. Rejections matter as much as commitments: when the system was right and was overruled, that is in the record, and when it was wrong, that is too.
- **The pre-mortem.** Before a high-value action is committed, the Confounder runs a pre-mortem on demand: "assume this action failed; rank the most likely reasons." The output (ranked failure modes with early-warning indicators) attaches to the decision record, and the indicators feed the proactive push rules so the system watches for the failure it predicted. This is the Confounder paying off a third time, and it is a one-call feature with outsized wow.
- **The decision audit view.** A board-grade timeline per tenant: decisions, the advice at the time, the pre-mortems, the outcomes, and the running value realised. For a PE-adjacent buyer this is governance evidence no mid-market tool provides: the answer to "what did management know and decide, and how did it play out" in one screen.

Acceptance: every action disposition creates a decision record with the evidence snapshot; a pre-mortem produces real ranked failure modes per tenant with watchable indicators wired to push; the audit timeline renders the full chain; overruled-and-right cases are visible, not buried.

## AM · AS-OF REASONING AND THE DILIGENCE PACK (the time machine, and the artifact your network will buy)

- **As-of replay.** Because pipeline runs, forecasts, decisions and the provenance ledger are all timestamped and append-only, build the as-of view: select a past date and see what the system believed then, layer by layer, with the confidence and efficacy it had at that time, and what changed since. No new data capture is needed; this is a read-model over what the prior phases already persist. It is the feature that makes the product feel like an institution's memory rather than a dashboard, and it is the diligence question ("what was known in March?") answered in one click.
- **The diligence pack.** A generated, export-grade document for a transaction or board context: the current 14-layer diagnosis, the efficacy and calibration record, the decision audit timeline, the outcome track record with value identified versus realised, and the provenance integrity attestation. Brand-styled, honest about modelled versus verified throughout. For your investor and PE network this is a product in itself: pre-diligence intelligence on a target or a portfolio company, generated from the system rather than from a data room scramble.

Acceptance: the as-of view reconstructs a past state faithfully for a tenant with history (tested by comparing against a snapshot taken earlier in the build); the diligence pack exports complete, brand-styled, with calibration and efficacy honestly presented; nothing in either view permits editing history.

## AN · VERIFICATION

1. Typecheck, build, full suite green in CI; em-dash sweep zero.
2. Brier maths unit-tested; calibration page honest on sample sizes; misses unfiltered.
3. The efficacy index moves correctly with data changes and differs honestly by mode.
4. Decision records, pre-mortems and the audit timeline complete and tamper-proof.
5. As-of replay verified against a known snapshot; the diligence pack exports.
6. Append to the consolidated build report: the scoring design, the index weights, the decision and forecast schemas, and the honest-labelling rules.

## EXECUTION ORDER

Phases AJ, AK, AL, AM, AN, in order, gated per the protocol. AJ and AK first because AL and AM consume their outputs. Add Phase AJ to the milestone review list: the owner verifies the calibration page is honest, the misses are visible, and the sample-size labelling cannot be gamed.
