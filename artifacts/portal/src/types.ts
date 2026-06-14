export type UserRole = "provider-owner" | "provider-member" | "client-admin" | "client-viewer";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  orgId: string | null;
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
