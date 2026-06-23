// Greenfield foundations: one coherent multi-tenant data model, designed once.
// Identity and access, native from day one.
export * from "./orgs";
export * from "./users";
export * from "./invitePins";
export * from "./accessGrants";
// The layer registry. No LAYER_KEYS constant exists anywhere; the registry is
// the single source of truth for layer identity.
export * from "./layers";
// Per-tenant content store.
export * from "./tenants";
export * from "./orgTenants";
export * from "./tenantProfile";
export * from "./tenantLayers";
export * from "./tenantLayerConfig";
export * from "./tenantArtifacts";
export * from "./tenantPipelineRuns";
// The Postgres-backed work queue the seed limiter runs on (brought forward from
// the Platform phase so concurrency is database-correct, never module memory).
export * from "./pipelineJobs";
// Optional shared rate-limit state (Phase D and O hardening). Default is the
// in-process map; RATE_LIMIT_STORE=postgres routes the auth fixed-window limiter
// and the connector token bucket through these tables so the limit holds across
// more than one instance. No tenant reference, no secret, no client data.
export * from "./rateLimits";
export * from "./committedActions";
// The outcome loop (Phase W): one measurement row per committed action grading
// what it actually realized against the prediction snapshotted at commit time.
export * from "./outcomeMeasurements";
// The Brier-scored calibration ledger (Phase AJ): one row per probabilistic
// forecast the Evaluator makes, with its outcome and Brier score filled in on
// resolution. Supersedes Phase W's loose calibration with a proper scoring rule.
export * from "./forecasts";
export * from "./claimBrokenReports";
// Connectors and SOC 2 (V2). The catalogue, per-tenant connections and runs, the
// "math, not records" derived signal store, the append-only provenance ledger,
// and per-tenant key references. access_grants (break-glass) already exists above.
export * from "./connectors";
export * from "./tenantConnections";
export * from "./connectorRuns";
export * from "./derivedSignals";
export * from "./provenanceLedger";
export * from "./tenantKeys";
// The local KMS emulation's durable keyring (development and CI only; a customer
// KMS replaces it in production). Holds key material behind the KMS seam, never
// referenced by application code outside lib/security/kms.
export * from "./kmsLocalKeys";
// Per-access break-glass audit events (access_grants holds the grant; this holds
// each access under it).
export * from "./accessGrantEvents";
// Per-tenant credential for the in-client extraction agent (Part 3, Tier 1).
export * from "./edgeAgents";
// Cost and token observability (Phase N): one measured row per real model call.
export * from "./modelUsage";
// Operational alert events (Phase O): the alert seam a connector error or a
// failed OAuth token refresh records, which the Phase P notifier consumes.
export * from "./alertEvents";
// Retention and deletion audit (Phase S): one row per scheduled TTL purge or
// operator-authorized tenant erasure of derived signals.
export * from "./retentionEvents";
// Backups and disaster recovery audit (Phase U): one row per real provenance
// ledger archive written to durable object storage.
export * from "./backupEvents";
// Benchmarking and the data network effect (Phase X): consent log, cohorts, and
// percentile stats. The cohort and stat tables carry NO tenant reference, so no
// join can reverse a published stat to a contributing tenant.
export * from "./benchmarks";
// Proactive Push Intelligence (Phase Z): per-user rules and the recorded,
// ranked, idempotent business-intelligence notifications they produce. Distinct
// seam from the operational alert_events of Phase O/P.
export * from "./pushIntelligence";
// Interactive Challenge (Phase AA): an append-only overlay recording each
// challenge of a specific finding and its Confounder + Synthesist re-reasoning
// (uphold or revise). Never mutates or deletes the challenged finding.
export * from "./findingChallenges";
// The decision ledger (Phase AL): one row per board-grade decision (commit,
// defer, reject) on a recommended action, with the system recommendation
// snapshotted at decision time, the human rationale, the linked AJ forecast, and
// one hash-chained provenance entry. "Overruled and right" is derivable from it.
export * from "./decisionRecords";
// On-demand pre-mortems (Phase AL): a real Confounder call attached to a
// decision record, returning ranked failure modes and early-warning indicators.
// The indicators are normalised so the Phase Z push evaluator can watch them.
export * from "./preMortems";
// As-of replay snapshots (Phase AM): one append-only row per layer build,
// capturing the diagnosis content exactly as it was persisted at that moment, so
// a past state can be reconstructed faithfully even though tenant_layers is
// overwritten in place on every refresh.
export * from "./tenantLayerSnapshots";
export * from "./diagnosisShareTokens";
// Ingestion suite (Phase AE): per-tenant ingestion credentials for the public
// Ingestion API and the MCP server, and per-source inbound webhook receivers
// with their signing secrets sealed under the tenant key. Every ingestion path
// lands on the one shared derive-and-discard persistence path; these tables hold
// only credential hashes and ciphertext, never raw client data.
export * from "./ingestionKeys";
export * from "./webhookSources";
// The Intelligence Gap Assessment (Phase AT): the top-of-funnel self assessment
// submissions (scored answers, computed four-dimension scores, qualification, an
// optional captured contact and an optional outside_in diagnosis snapshot) and
// their forwardable share tokens. No tenant reference and no raw client data:
// the optional diagnosis stores only a narrow profile projection, never HTML.
export * from "./assessmentSubmissions";
export * from "./assessmentShareTokens";
