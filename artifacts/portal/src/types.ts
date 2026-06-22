export type UserRole = "provider-owner" | "provider-member" | "client-admin" | "client-viewer";
export type OrgType = "provider" | "client" | "portfolio";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  orgId: string | null;
  // The type of the user's org, resolved server-side alongside the user. Null
  // when the seat has no org. The portal reads this only to offer the portfolio
  // nav to a portfolio seat; the server fences the data by binding, not by this.
  orgType: OrgType | null;
}

export interface Pin {
  id: string;
  code?: string; // only on create
  label: string | null;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  revokedAt: string | null;
  scopeOrgId: string | null;
  scopeRole: string | null;
  createdAt: string;
  state: "active" | "expired" | "revoked" | "used-up";
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: "active" | "disabled";
  orgId: string | null;
  orgName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  url: string;
  status: string;
}

export interface Org {
  id: string;
  name: string;
  type: "provider" | "client" | "portfolio";
  createdAt: string;
  tenants: { id: string; name: string }[];
}

// ── Portfolio Intelligence (Phase Y) ───────────────────────────────────────
// The shape of GET /api/portfolio/summary, mirroring the server's portfolioMath
// output exactly. Every figure is a real persisted value or null; a company with
// no numeric prediction carries null dollar figures (the board shows a dash),
// never a fabricated zero or a fabricated "value at risk".
export type GapSeverity = "high" | "medium" | "low";
export type PortfolioScopeType = "provider" | "portfolio";

export interface PortfolioOpenGaps {
  total: number;
  high: number;
  medium: number;
  low: number;
  severityScore: number;
}
export interface PortfolioCompleteness {
  hasLayerContent: boolean;
  hasOutcomes: boolean;
  missing: string[];
}
export interface PortfolioScope {
  type: PortfolioScopeType;
  orgId: string | null;
  orgName: string | null;
}
export interface PortfolioTotals {
  tenantCount: number;
  valueIdentifiedUsd: number | null;
  valueRealizedUsd: number | null;
  unrealizedValueUsd: number | null;
  openGaps: PortfolioOpenGaps;
  tenantsWithLayerContent: number;
  tenantsWithOutcomes: number;
}
export interface PortfolioTenant {
  rank: number;
  tenantId: string;
  tenantName: string;
  status: string;
  dataMode: string;
  generatedLayers: number;
  totalLayers: number;
  valueIdentifiedUsd: number | null;
  valueRealizedUsd: number | null;
  unrealizedValueUsd: number | null;
  overallConfidence: number | null;
  confidenceLayers: number;
  // Phase AK: the tenant's Data Efficacy rollup (mean of its generated layers'
  // indices) and its standing in the SEPARATE efficacy ranking. A null score is
  // an honest dash (no generated layer), never a fabricated zero; efficacyRank
  // orders by data quality, distinct from the value-based rank above.
  efficacyScore: number | null;
  efficacyLayers: number;
  efficacyRank: number;
  openGaps: PortfolioOpenGaps;
  completeness: PortfolioCompleteness;
}
export interface PortfolioPattern {
  layerKey: string;
  layerName: string;
  kind: GapKind | null;
  affectedTenants: number;
  totalTenants: number;
  share: number;
  severity: GapSeverity;
  tenantIds: string[];
  examples: string[];
}
export interface PortfolioSummary {
  scope: PortfolioScope;
  totals: PortfolioTotals;
  tenants: PortfolioTenant[];
  patterns: PortfolioPattern[];
}

// ── Proactive Push Intelligence (Phase Z) ──────────────────────────────────
// The shape of the /api/push surface, mirroring the server's serializers
// exactly. Every figure is a real persisted value or null; an event with no
// dollar prediction carries a null impact (the center shows a dash) and a zero
// rank score, never a fabricated number. A suppressed event is shown in the
// center, visually distinct, but never counts toward the unread badge.
export type PushDeliveryStatus = "pending" | "suppressed" | "sent" | "failed";
export type PushChannel = "in_app" | "slack" | "email";
export type PushRuleType = "outcome_shortfall" | "high_value_action";

export interface PushNotification {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  sourceType: string;
  sourceId: string;
  title: string;
  message: string;
  impactUsd: number | null;
  confidence: number | null;
  rankScore: number;
  deliveryStatus: PushDeliveryStatus;
  channel: PushChannel;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface PushNotifications {
  notifications: PushNotification[];
  unreadCount: number;
}

export interface PushRule {
  id: string;
  tenantId: string;
  tenantName: string | null;
  type: PushRuleType;
  enabled: boolean;
  mutedUntil: string | null;
  minImpactUsd: number | null;
  minConfidence: number | null;
  channel: PushChannel;
}

// ── Intelligence domain (Phase E) ──────────────────────────────────────────
// These mirror the persisted cortex output exactly. Every figure the portal
// shows is one of these real fields; nothing is invented client-side.

export type Tone = "good" | "warn" | "bad" | "neutral";
export type Basis = "verified" | "modelled";
export type GapKind = "DATA" | "SIGNAL" | "INTEG" | "MODEL" | "FLOW";

// One accessible tenant, from GET /api/tenants. Access-filtered server-side.
export interface TenantSummary {
  id: string;
  name: string;
  url: string;
  sector: string | null;
  tagline: string | null;
  status: string;
  lastSeededAt: string | null;
}

// A registry layer, from GET /api/layers. The single source of layer identity.
export interface LayerRegistryEntry {
  key: string;
  name: string;
  description: string;
  archetype: string;
  heroDescription: string;
  diagnosticQuestion: string;
  ownerPersona: string;
  metricDefinitions: string[];
  rootCauses: string[];
  actions: string[];
  gaps: string[];
  feeds: string[];
  moduleGroup: string;
  sortOrder: number;
}

// ── Stored layer content (written by the cortex, confidence + basis present) ──
export interface LayerMetric {
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
  confidence: number;
  basis: Basis;
}
export interface LayerCause {
  title: string;
  impact: string;
  detail: string;
  confidence: number;
  basis: Basis;
}
export interface LayerAction {
  title: string;
  detail: string;
  impact: string;
  timing?: string;
  owner?: string;
  confidence: number;
  basis: Basis;
}
export interface LayerHypothesis {
  statement: string;
  supportingSignals?: string;
  alternativeExplanation?: string;
  confidence: number;
  basis: Basis;
}
export interface ProofItem {
  source: string;
  observation: string;
}
export interface LayerGap {
  kind: GapKind;
  description: string;
  closes?: string;
  confidence_lift_pp: number;
}
export interface LayerContent {
  narrative: string;
  headline_finding: string;
  headline_impact: string;
  headline_lever: string;
  causes: LayerCause[];
  actions: LayerAction[];
  hypotheses: LayerHypothesis[];
  proof: { items: ProofItem[] };
  gaps: LayerGap[];
  metrics: LayerMetric[];
  confidence: number;
  confidence_gap: number;
}

// ── Enrichment outputs ──
export interface TrendPoint {
  label: string;
  value: number;
}
export interface HeroPanel {
  metric_label: string;
  metric_value: string;
  metric_sub?: string;
  tone: Tone;
  one_line_read: string;
  trend: TrendPoint[];
}
export interface PeerEntry {
  name: string;
  value?: string;
  note?: string;
  is_self?: boolean;
}
export interface PeerBenchmark {
  dimension: string;
  unit?: string;
  peers: PeerEntry[];
  read?: string;
  source_urls: string[];
}

// ── Verified-cohort benchmark (Phase X) ──
// The de-identified peer distribution for the tenant's own segment. It carries NO
// peer identity and NO raw peer values: only percentile bands computed across a
// cohort that has cleared the k-anonymity floor, plus the requester's OWN position
// in each band. A locked cohort is one still forming below that floor.
export interface CohortMetric {
  signalKey: string;
  window: string | null;
  // The requester's own value for this metric, or null when they have no scalar
  // for it (or their key is crypto-shredded). Their own data, never a peer's.
  self: number | null;
  p25: number;
  p50: number;
  p75: number;
  // Distinct tenants behind this distribution (always at or above the k floor).
  sampleCount: number;
  // True when bounded privacy noise was applied; surfaced honestly, not hidden.
  noised: boolean;
}
export interface CohortBenchmark {
  basis: "verified_cohort";
  sector: string;
  revenueBand: string;
  metrics: CohortMetric[];
}
export interface CohortLock {
  sector: string;
  revenueBand: string;
  // Opted-in peers currently sharing the requester's segment (the requester
  // included), and the k floor the cohort must reach to unlock.
  currentCount: number;
  unlocksAt: number;
}

// ── Benchmark consent (Phase X) ──
// Participation is default-off and every change is appended to a tenant audit.
export type BenchmarkConsentAction = "opt_in" | "opt_out";
export interface BenchmarkConsentEvent {
  id: string;
  tenantId: string | null;
  action: BenchmarkConsentAction;
  authorityUserId: string | null;
  authorityRole: string;
  reason: string | null;
  createdAt: string;
}
export interface BenchmarkConsentState {
  optIn: boolean;
  events: BenchmarkConsentEvent[];
}

export type SupplementKind = "context" | "risk" | "watchlist" | "quote" | "stat";
export interface SupplementBlock {
  kind: SupplementKind;
  title: string;
  body: string;
  source_urls: string[];
}

// ── The genuine Confounder stage ──
export type ConfounderVerdict = "ruled_out" | "partial" | "unresolved";
export interface Confounder {
  rank: number;
  name: string;
  mechanism: string;
  directional_impact: string;
  verdict: ConfounderVerdict;
  reason: string;
  source_urls: string[];
}

// ── Verified / modelled claim split ──
export interface VerifiedClaim {
  claim_text: string;
  claim_path: string;
  source_urls: string[];
  source_titles: string[];
  verified_by: string;
  verified_at?: string;
  reconciled?: boolean;
}
export interface ModelledClaim {
  claim_text: string;
  claim_path: string;
  rationale?: string;
  consistency?: "consistent" | "tension" | "unknown";
  source_urls: string[];
}

// GET /api/tenants/:id/layers/:key
export interface TenantLayerDetail {
  tenantId: string;
  layerKey: string;
  content: LayerContent;
  heroPanel: HeroPanel | null;
  peerBenchmark: PeerBenchmark | null;
  // Phase X: the de-identified verified-cohort distribution when the segment has
  // cleared the k floor, or an honest lock state while the cohort is still
  // forming. Both null when the tenant has not opted in. Never a peer identity.
  cohortBenchmark: CohortBenchmark | null;
  cohortLock: CohortLock | null;
  supplementBlocks: { blocks: SupplementBlock[] } | null;
  confounders: Confounder[] | null;
  verifiedClaims: { items: VerifiedClaim[] } | null;
  modelledClaims: { items: ModelledClaim[] } | null;
  // True when this layer was built with the reduced express chain (the confound
  // and challenge sub-stages skipped). The layer surfaces an "express build"
  // pill; a full refresh rebuilds it with the complete chain.
  reducedMode: boolean;
  generatorModel: string;
  generatedAt: string;
  // Phase AJ: a display-only confidence advisory disciplined by this layer's own
  // Brier track record. Null when the content carries no numeric overall
  // confidence. The raw confidence in content is never overwritten; the page
  // shows the raw pill and an honest label, and only applies the disciplined
  // value once the layer has cleared the resolved-sample threshold.
  confidenceCalibration: LayerConfidenceAdvisory | null;
  // Phase AK: the read-time Data Efficacy Index for this layer (how good the fuel
  // was), or null when the layer has not been generated. Confidence says how sure
  // the reasoning is; this says how good the data behind it was.
  efficacyIndex: EfficacyIndex | null;
}

// ── Data Efficacy Index (Phase AK) ───────────────────────────────────────────
// A 0-to-100 read-time index of how good the data behind a layer is, from five
// named drivers. Mirrors the server EfficacyIndex shape exactly; nothing here is
// stored, so it can never drift from the data it describes. A null driver value
// is "not measured" (contributes zero but is shown as a dash), never a zero.
export type EfficacyDriverKey =
  | "coverage"
  | "freshness"
  | "verificationRate"
  | "adversarialSurvival"
  | "sourceDiversity";
export type EfficacyDataMode = "outside_in" | "connected";
export type EfficacyDriverStatus = "measured" | "not_measured";

export interface EfficacyDriverResult {
  key: EfficacyDriverKey;
  label: string;
  value: number | null;
  status: EfficacyDriverStatus;
  weight: number;
  contributionPoints: number;
  reason: string;
}

export interface EfficacyCheapestImprovement {
  driver: EfficacyDriverKey;
  label: string;
  liftPoints: number;
  hint: string;
}

export interface EfficacyIndex {
  score: number;
  drivers: EfficacyDriverResult[];
  unknownWeight: number;
  modeCeiling: number;
  dataMode: EfficacyDataMode;
  cheapestImprovement: EfficacyCheapestImprovement | null;
}

export interface LayerEfficacySummary {
  layerKey: string;
  layerName: string;
  generated: boolean;
  index: EfficacyIndex | null;
}

export interface TenantEfficacy {
  dataMode: EfficacyDataMode;
  modeCeiling: number;
  rollup: { score: number | null; n: number };
  layers: LayerEfficacySummary[];
}

// ── As-of replay (Phase AM) ──────────────────────────────────────────────────
// A read-model over append-only, timestamped state: pick a past instant and see
// what the system believed THEN, layer by layer, with the confidence and
// data-efficacy it had earned by then, plus an honest diff of what has changed
// since. Mirrors the server TenantAsOf shape exactly; nothing here is stored and
// nothing edits history. A delta is a number only when both sides carry the
// figure, otherwise null (the surface says "unavailable", never implies a zero).
export interface AsOfLayerDiff {
  hasCurrent: boolean;
  contentChanged: boolean | null;
  efficacyDelta: number | null;
  confidenceDelta: number | null;
  verifiedDelta: number | null;
  modelledDelta: number | null;
  confounderDelta: number | null;
}

export interface AsOfLayerView {
  layerKey: string;
  layerName: string;
  // Whether a build existed for this layer at or before the as-of date. False is
  // the honest "history unavailable" state, never a fabricated empty diagnosis.
  available: boolean;
  reason: string | null;
  snapshotAt: string | null;
  generatorModel: string | null;
  reducedMode: boolean | null;
  content: Record<string, unknown> | null;
  heroPanel: Record<string, unknown> | null;
  peerBenchmark: Record<string, unknown> | null;
  supplementBlocks: Record<string, unknown> | null;
  confounders: unknown[] | null;
  verifiedClaims: Record<string, unknown> | null;
  modelledClaims: Record<string, unknown> | null;
  voiceQuality: Record<string, unknown> | null;
  confidence: LayerConfidenceAdvisory | null;
  efficacy: EfficacyIndex | null;
  changedSince: AsOfLayerDiff;
}

export interface TenantAsOf {
  tenantId: string;
  tenantName: string;
  dataMode: EfficacyDataMode;
  asOf: string;
  now: string;
  hasHistory: boolean;
  earliestSnapshotAt: string | null;
  latestSnapshotAt: string | null;
  layers: AsOfLayerView[];
  ledger: { entriesAsOf: number; entriesCurrent: number };
  decisionsSince: number;
  outcomesSince: number;
}

// ── Brier-scored calibration (Phase AJ) ──────────────────────────────────────
// Every figure mirrors a real resolved-forecast computation server-side. A
// forecast is a probability the real Evaluator stated; its outcome is read only
// from a persisted measurement or an owner adjudication, never synthesised. The
// Brier score is the mean squared error: 0 is perfect, 0.25 is the coin-flip
// baseline, above 0.25 is worse than chance. Nothing here is fabricated; a thin
// sample carries an honest label rather than a dressed-up track record.

// The honest sample-size label: "established" once the resolved count clears the
// threshold, otherwise "early, n resolved".
export interface SampleLabel {
  established: boolean;
  label: string;
}

// The display-only advisory for a single layer's confidence pill.
export interface LayerConfidenceAdvisory {
  raw: number;
  adjusted: number;
  applied: boolean;
  reason: "insufficient_sample" | "well_calibrated" | "overconfident_penalty";
  penalty: number;
  n: number;
  brier: number | null;
  threshold: number;
  label: SampleLabel;
}

export interface CalibrationScope {
  kind: "system" | "tenant";
  tenantId: string | null;
  tenantName: string | null;
}

export interface CalibrationHeadline {
  meanBrier: number | null;
  n: number;
  label: SampleLabel;
  beatsBaseline: boolean | null;
}

// One stated-probability band of the reliability curve. avgProbability and
// observedFrequency are null for an empty band: no point is plotted for no data.
export interface CalibrationBand {
  lower: number;
  upper: number;
  n: number;
  avgProbability: number | null;
  observedFrequency: number | null;
}

export interface CalibrationSegment {
  key: string;
  meanBrier: number | null;
  n: number;
  label: SampleLabel;
}

// One resolved forecast in the visible ledger. The ledger always includes misses
// (outcome 0); it is a track record, not a highlight reel.
export interface CalibrationLedgerRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  layerKey: string;
  kind: string;
  subjectSeat: string;
  statement: string;
  sourcePath: string | null;
  probability: number;
  outcome: number;
  brierScore: number | null;
  resolutionBasis: string | null;
  madeAt: string | null;
  resolveBy: string | null;
  resolvedAt: string | null;
}

export interface CalibrationSummary {
  scope: CalibrationScope;
  threshold: number;
  baseline: number;
  headline: CalibrationHeadline;
  curve: CalibrationBand[];
  byLayer: CalibrationSegment[];
  byKind: CalibrationSegment[];
  bySeat: CalibrationSegment[];
  resolvedCount: number;
  openCount: number;
  ledger: CalibrationLedgerRow[];
}

// ── Pipeline runs (the boot splash + Intelligence Architecture read these) ──
// "skipped" is a terminal sub-stage state the reduced express chain produces for
// the confound and challenge stages it deliberately did not run; honest, and
// distinct from "done".
export type SubStageStatus = "pending" | "running" | "done" | "error" | "skipped";
export interface SeatTelemetry {
  seat?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  searchCalls?: number;
  // True on the peers and supplements sub-stages, whose cost was folded into a
  // single batched Evaluator call recorded on hero. The Intelligence
  // Architecture summation reads this to avoid triple-counting that one call.
  batched?: boolean;
  // Sovereign-mode honesty markers (Phase AF). Present only on sub-stages a
  // sovereign run produced: the whole pipeline ran in-boundary on the local seat
  // with no external provider, so no external grounding or web-search channel was
  // available. Absent on outside_in and connected runs, so the strip is unchanged
  // for them. These are recorded by the runner, never inferred by the portal.
  executionMode?: "sovereign";
  groundingAvailable?: boolean;
  webSearchAvailable?: boolean;
}
export interface SubStage {
  name: string;
  status: SubStageStatus;
  durationMs: number | null;
  error: string | null;
  telemetry: SeatTelemetry | null;
}
export type RunStatus = "queued" | "running" | "done" | "error";
export interface PipelineRun {
  id: string;
  layerKey: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  subStages: SubStage[];
}

// ── Committed actions / track record ──
export type CommittedActionStatus = "committed" | "in_progress" | "done" | "dismissed";
export interface CommittedAction {
  id: string;
  tenantId: string;
  layerKey: string;
  title: string;
  detail: string | null;
  predictedImpact: string | null;
  // The numeric dollar prediction snapshotted at commit, or null when the impact
  // string carried no parseable dollar figure. Postgres numeric arrives as a
  // string over the wire; the portal parses it for display only.
  predictedValueUsd: string | null;
  baselineMetric: string | null;
  baselineAt: string | null;
  timing: string | null;
  actionOwner: string | null;
  basis: Basis;
  confidence: number;
  status: CommittedActionStatus;
  note: string | null;
  committedBy: string;
  committedAt: string;
  updatedAt: string;
}

// ── Outcome loop / value realized ──
export type OutcomeMeasurementBasis = "measured" | "modelled";
export type OutcomeMeasurementStatus = "pending" | "on_track" | "realized" | "missed";

export interface OutcomeMeasurement {
  id: string;
  actionId: string;
  actualMetric: string | null;
  realizedValueUsd: string | null;
  varianceVsPrediction: string | null;
  basis: OutcomeMeasurementBasis;
  status: OutcomeMeasurementStatus;
  note: string | null;
  measuredAt: string;
  createdAt: string;
}

// The simple calibration grade. score is hits over resolved, or null when
// nothing has resolved yet (an honest "not enough signal", never a fabricated 0).
export interface OutcomeCalibration {
  score: number | null;
  hits: number;
  misses: number;
  resolved: number;
}

export interface OutcomeSummary {
  valueIdentifiedUsd: number;
  valueRealizedUsd: number;
  actionsWithPrediction: number;
  actionsMeasured: number;
  calibration: OutcomeCalibration;
}

export interface TenantOutcomes {
  summary: OutcomeSummary;
  measurements: OutcomeMeasurement[];
}

// ── Outcome loop closure (GET /api/tenants/:id/outcome-loop) ──
// A read that closes the loop on committed decisions: the recommendation the
// board acted on, the action it created, the forecast that prediction bound, and
// the measurement and Brier-scored resolution that graded it. A stage that has
// not happened yet is null, never a fabricated zero.
export interface OutcomeLoopRecommendation {
  title: string;
  detail: string | null;
  impact: string | null;
  predictedValueUsd: number | null;
  confidence: number;
  // "verified" or "modelled" as stored; the page maps it to a provenance pill.
  basis: string;
  verified: boolean;
  evidenceRefs: { claimPath: string; contentHash: string }[];
  provenanceContentHash: string;
}

export interface OutcomeLoopForecast {
  id: string;
  statement: string;
  probability: number | null;
  outcome: 0 | 1 | null;
  resolved: boolean;
  resolvedAt: string | null;
  brierScore: number | null;
  // measured, modelled, or owner: how the forecast was resolved. Null while open.
  resolutionBasis: string | null;
}

export interface OutcomeLoopMeasurement {
  id: string;
  status: string;
  // measured only when a real scalar signal backed it; otherwise modelled.
  basis: string;
  realizedValueUsd: number | null;
  varianceVsPrediction: number | null;
  measuredAt: string;
}

export interface OutcomeLoopEntry {
  decisionId: string;
  decidedAt: string;
  layerKey: string;
  actionRef: string | null;
  rationale: string | null;
  decidedByEmail: string | null;
  state: "open" | "resolved";
  recommendation: OutcomeLoopRecommendation;
  action: { id: string; status: string } | null;
  forecast: OutcomeLoopForecast | null;
  measurement: OutcomeLoopMeasurement | null;
}

export interface OutcomeLoopSummary {
  total: number;
  closed: number;
  open: number;
  // Mean Brier over the resolved loops, or null when none have resolved.
  brierMean: number | null;
}

export interface OutcomeLoop {
  tenantId: string;
  summary: OutcomeLoopSummary;
  loops: OutcomeLoopEntry[];
}

// The stored tenant profile blob (homepage ground truth). Loosely typed: the
// shell reads a few known fields and tolerates the rest.
export interface TenantProfile {
  [key: string]: unknown;
}

// The perspective lens re-weights which layers lead. Pure registry re-ordering.
export type Perspective = "operator" | "investor" | "board";

// ── Tenant overview (GET /api/tenants/:id/overview) ──
// A compact per-layer projection the Morning Brief and Board Pack assemble from,
// so neither surface fans out fourteen detail requests. Every field is a real
// persisted value or null; the server selects (lead metric, first action,
// highest-lift gap) but never computes or fabricates a figure.
export interface OverviewMetric {
  label: string | null;
  value: string | null;
  sub: string | null;
  tone: Tone | null;
}
export interface OverviewHero {
  metricLabel: string | null;
  metricValue: string | null;
  metricSub: string | null;
  tone: Tone | null;
  oneLineRead: string | null;
}
export interface OverviewAction {
  title: string | null;
  impact: string | null;
  timing: string | null;
  confidence: number | null;
  basis: Basis | null;
}
export interface OverviewGap {
  kind: GapKind | null;
  description: string | null;
  closes: string | null;
  confidenceLiftPp: number | null;
}
export interface OverviewLayer {
  key: string;
  name: string;
  archetype: string;
  ownerPersona: string;
  moduleGroup: string;
  sortOrder: number;
  diagnosticQuestion: string;
  feeds: string[];
  generated: boolean;
  headlineFinding: string | null;
  headlineImpact: string | null;
  headlineLever: string | null;
  narrative: string | null;
  confidence: number | null;
  confidenceGap: number | null;
  leadMetric: OverviewMetric | null;
  hero: OverviewHero | null;
  topAction: OverviewAction | null;
  topGap: OverviewGap | null;
  generatedAt: string | null;
  generatorModel: string | null;
}

// Sellability Pack (Phase AB).
// Read-only shareable diagnosis links and anonymized case studies. Every figure
// mirrors a real backend value: a share carries only metadata (never the token
// or its hash after mint), and a case study is an aggregate over a cohort that
// has cleared the k-anonymity floor, never a named company.
export type ShareTokenStatus = "active" | "expired" | "revoked";
export type DiagnosisSharePrivacy = "summary_only";

export interface ShareToken {
  id: string;
  privacyLevel: DiagnosisSharePrivacy;
  label: string | null;
  status: ShareTokenStatus;
  expiresAt: string;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
}

// Returned ONLY from mint: the plaintext token and its portal path, never
// readable again from any list. The caller composes the absolute URL.
export interface MintedShareToken extends ShareToken {
  token: string;
  diagnosisPath: string;
}

export interface CaseStudyQuartiles {
  p25: number;
  p50: number;
  p75: number;
}
export interface CaseStudyCalibration {
  hits: number;
  misses: number;
  resolved: number;
  score: number | null;
}
export interface CaseStudy {
  segmentKey: string;
  sector: string;
  revenueBand: string;
  contributorCount: number;
  noised: boolean;
  realizedUsd: CaseStudyQuartiles;
  identifiedUsd: CaseStudyQuartiles;
  calibration: CaseStudyCalibration;
}

// The public shareable diagnosis (GET /api/public/diagnosis/:token). The layer is
// the board-pack overview shape narrowed to its public fields: the internal owner
// persona, diagnostic question, and layer feed graph are stripped server side, so
// a prospect never receives them.
export type PublicDiagnosisLayer = Omit<
  OverviewLayer,
  "ownerPersona" | "diagnosticQuestion" | "feeds"
>;
export interface PoweredByMark {
  label: string;
  href: string;
}
export interface PublicDiagnosis {
  layers: PublicDiagnosisLayer[];
  caseStudy: CaseStudy | null;
  poweredBy: PoweredByMark;
}

// ── Tenant signals (GET /api/tenants/:id/signals) ──
// The heavier companion to /overview: the FULL per-layer signal arrays that the
// derived surfaces (anomaly inbox, dependency map, Ask Different Day, war room)
// reason over. Every field is a real persisted value or null; the server never
// computes a figure here. The derive functions in lib/anomalies, lib/dependency
// and lib/heartbeat are pure over this shape and unit-tested.
export interface SignalGap {
  kind: GapKind | null;
  description: string | null;
  closes: string | null;
  confidenceLiftPp: number | null;
}
export interface SignalAction {
  title: string | null;
  impact: string | null;
  timing: string | null;
  owner: string | null;
  basis: Basis | null;
  confidence: number | null;
}
export interface SignalCause {
  title: string | null;
  impact: string | null;
  confidence: number | null;
  basis: Basis | null;
}
export interface SignalHypothesis {
  statement: string | null;
  confidence: number | null;
  basis: Basis | null;
}
export interface SignalConfounder {
  rank: number | null;
  name: string | null;
  mechanism: string | null;
  directionalImpact: string | null;
  verdict: ConfounderVerdict | null;
  reason: string | null;
}
export interface SignalLayer {
  key: string;
  name: string;
  moduleGroup: string;
  feeds: string[];
  sortOrder: number;
  ownerPersona: string;
  generated: boolean;
  headlineFinding: string | null;
  headlineImpact: string | null;
  headlineLever: string | null;
  confidence: number | null;
  confidenceGap: number | null;
  causes: SignalCause[];
  actions: SignalAction[];
  gaps: SignalGap[];
  hypotheses: SignalHypothesis[];
  confounders: SignalConfounder[];
  verifiedCount: number;
  modelledCount: number;
  generatedAt: string | null;
  generatorModel: string | null;
}

// ── Intelligence architecture (GET /api/architecture) ──
// The fixed three-seat, nine-stage shape of the cortex, identical for every
// tenant. Model identifier strings live only in the api-server's cortex config
// and are surfaced here, so the portal never hardcodes a model string.
export interface ArchitectureSeat {
  provider: string;
  model: string;
}
export interface ArchitectureStage {
  name: string;
  seat: string;
  role: string;
  provider: string;
  model: string;
  webSearch: boolean;
  grounding: boolean;
}
export interface Architecture {
  seats: Record<string, ArchitectureSeat>;
  stages: ArchitectureStage[];
}

// ── Cost and token observability (Phase N, GET /api/spend/summary) ────────────
// Every figure mirrors a real model_usage ledger sum: each row there is one real
// model call, priced from its real token counts at the configured list-price
// rates. Nothing on this surface is estimated or projected. Owner-only.
export interface SpendTotals {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  webSearchCalls: number;
}
export interface SpendCaps {
  globalMonthlyCapUsd: number;
  tenantMonthlyCapUsd: number;
  alertThreshold: number;
  monthStart: string;
  globalMonthSpendUsd: number;
  globalOverThreshold: boolean;
  globalOverCap: boolean;
}
export interface SpendByTenant {
  tenantId: string | null;
  name: string | null;
  costUsd: number;
  calls: number;
}
export interface SpendBySeat {
  seat: string;
  costUsd: number;
  calls: number;
}
export interface SpendByStage {
  stage: string;
  costUsd: number;
  calls: number;
}
export interface SpendByRun {
  runId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  layerKey: string | null;
  costUsd: number;
  calls: number;
  at: string;
}
export interface SpendDaily {
  day: string;
  costUsd: number;
}
export interface SpendSummary {
  total: SpendTotals;
  caps: SpendCaps;
  byTenant: SpendByTenant[];
  bySeat: SpendBySeat[];
  byStage: SpendByStage[];
  byRun: SpendByRun[];
  daily: SpendDaily[];
}

// ── Tier 3 security surface (Phase L UI over the Phase K backend) ─────────────
// Every field mirrors the real /api/security payloads. Nothing here is invented
// client-side: a declared-but-unconnected KMS reports its honest state, a revoked
// key is shown as such, and the three typed read failures map to explicit states.

export interface KmsStatus {
  provider: string;
  connected: boolean;
  detail: string;
}

// GET /api/security/tenants/:id/key. status is "none" when no key is provisioned.
export interface KeyStatus {
  tenantId: string;
  provisioned: boolean;
  status: "active" | "revoked" | "none";
  revokedAt: string | null;
  kms: KmsStatus;
  customerKms: KmsStatus;
}

// A break-glass grant row from GET/POST .../grants. Dates are ISO strings.
export interface Grant {
  id: string;
  userId: string;
  tenantId: string;
  grantedBy: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

// One audit row from GET .../access-events, newest first.
export interface AccessEvent {
  id: string;
  grantId: string;
  userId: string;
  tenantId: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

// GET .../provenance/verify. brokenAt and detail appear only on a broken chain.
export interface VerifyResult {
  ok: boolean;
  length: number;
  brokenAt?: number;
  detail?: string;
}

// One decrypted signal from GET .../signals, reachable only under a break-glass
// grant. value is a scalar or a vector exactly as the math produced it.
export interface HumanSignal {
  layerKey: string;
  signalKey: string;
  value: number | number[];
  window: string | null;
  sourceConnectorKey: string | null;
  computedAt: string;
}

// Connector health (Phase O, GET /api/security/tenants/:id/connector-health).
// Derived at read time from each connection's real last-success and last-error
// timestamps and the connector's staleness threshold; never stored, never
// fabricated. A connection that has never run reads as degraded, not healthy.
export type ConnectionHealth = "healthy" | "degraded" | "error";

export interface ConnectorHealthRow {
  connectorKey: string;
  name: string;
  deployment: "edge" | "boundary" | null;
  status: string;
  health: ConnectionHealth;
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  stalenessThresholdSeconds: number;
}

export interface ConnectorHealthReport {
  tenantId: string;
  connections: ConnectorHealthRow[];
}

// ── Interactive Challenge (Phase AA) ──
// A challenge re-reasons ONE finding. status "completed" carries an outcome
// (upheld|revised); "failed" carries an honest error and no outcome. A revise
// carries a new confidence and the basis "modelled_user_informed", shown only
// on the challenge, never folded into the layer's verified|modelled vocabulary.
// isCurrentVersion is true when the challenge still addresses the live finding,
// false when a refresh has since changed it, null when the finding is gone.
export type FindingChallengeStatus = "completed" | "failed";
export type FindingChallengeOutcome = "upheld" | "revised";

export interface FindingChallenge {
  id: string;
  layerKey: string;
  findingRef: string;
  findingTitle: string;
  challengerEmail: string | null;
  challengeText: string;
  status: FindingChallengeStatus;
  outcome: FindingChallengeOutcome | null;
  originalConfidence: number | null;
  originalBasis: string | null;
  revisedConfidence: number | null;
  revisedBasis: string | null;
  confounderNote: string | null;
  reasoning: string | null;
  error: string | null;
  provenanceContentHash: string | null;
  isCurrentVersion: boolean | null;
  createdAt: string;
}

// ── Decision ledger + pre-mortem (Phase AL) ──
// A board decision recorded against a recommended action: a commit (the action
// was taken, also creating a committed action and binding its forecast), or a
// defer or reject (the recommendation stays in the diagnosis, the audit captures
// that it was deliberately not taken). Every figure on the timeline is read from
// persisted state; "overruled and right" is derived at read time from the linked
// forecast resolution, never stored as a flag that could drift.
export type DecisionKind = "commit" | "defer" | "reject";
export type OverruledStatus = "right" | "wrong" | "pending" | null;
export type PreMortemStatus = "completed" | "failed";
export type PreMortemIndicatorStatus = "active" | "triggered" | "cleared";

export interface PreMortemFailureMode {
  rank: number;
  title: string;
  mechanism: string;
  likelihood: string;
  earlyWarning: string;
}

export interface PreMortemIndicator {
  id: string;
  failureModeRank: number;
  failureModeTitle: string;
  label: string;
  status: PreMortemIndicatorStatus;
  triggeredAt: string | null;
  clearedAt: string | null;
}

export interface PreMortem {
  id: string;
  status: PreMortemStatus;
  failureModes: PreMortemFailureMode[];
  residualRiskNote: string | null;
  error: string | null;
  provenanceContentHash: string | null;
  indicators: PreMortemIndicator[];
  createdAt: string;
}

export interface DecisionTimelineEntry {
  id: string;
  decidedAt: string;
  decision: DecisionKind;
  layerKey: string;
  actionRef: string | null;
  recommendedTitle: string;
  recommendedDetail: string | null;
  recommendedImpact: string | null;
  recommendedValueUsd: number | null;
  systemConfidence: number;
  systemBasis: string;
  recommendationVerified: boolean;
  evidenceRefs: { claimPath: string; contentHash: string }[];
  contradictsRecommendation: boolean;
  rationale: string | null;
  decidedByEmail: string | null;
  provenanceContentHash: string;
  committedActionId: string | null;
  actionStatus: string | null;
  realizedValueUsd: number | null;
  measurementStatus: string | null;
  forecastId: string | null;
  forecastProbability: number | null;
  forecastResolved: boolean;
  forecastOutcome: 0 | 1 | null;
  forecastBrierScore: number | null;
  overruledStatus: OverruledStatus;
  preMortems: PreMortem[];
  cumulativeRealizedValueUsd: number;
}

export interface DecisionTimelineSummary {
  totalDecisions: number;
  commits: number;
  defers: number;
  rejects: number;
  overruledRight: number;
  overruledWrong: number;
  overruledPending: number;
  totalIdentifiedValueUsd: number;
  totalRealizedValueUsd: number;
}

export interface DecisionTimeline {
  entries: DecisionTimelineEntry[];
  summary: DecisionTimelineSummary;
}
