// @workspace/cortex: the pure three-model intelligence engine. No database, no
// HTTP server. The orchestrator (api-server) wires these stage runners to the
// registry and the tenant store.

export const CORTEX_PACKAGE = "@workspace/cortex";

// Configuration (the single source of model identifiers).
export {
  SEATS,
  STAGE_CONFIG,
  LAYER_STAGES,
  VERIFICATION_CHANNELS,
  IN_BOUNDARY_STAGES,
  modelForStage,
  seatForStage,
  runsInBoundary,
  resolveLocalSeat,
  type Provider,
  type SeatKey,
  type SeatConfig,
  type StageName,
  type StageConfig,
  type VerificationChannel,
  type CortexDataMode,
  type LocalSeatConfig,
} from "./config";

// Logger contract.
export { silentLogger, consoleLogger, type Logger, type LogFields } from "./logger";

// JSON extraction utilities.
export { stripJsonFence, extractJsonObject, parseJsonLoose, parseAndValidate } from "./json";

// Typography enforcement (the long-dash ban applied to generated content).
export { stripDashes, deepStripDashes } from "./sanitize";

// Grounding.
export {
  fetchHomepageContext,
  isHostnameSafe,
  isPrivateAddress,
  type HomepageContext,
} from "./grounding/homepageContext";

// Prompt-facing descriptor and the connected-mode grounding contract.
export {
  derivedSignalsBlock,
  groundingSection,
  type LayerDescriptor,
  type DerivedSignalView,
  type LayerGrounding,
} from "./prompts/shared";

// Schemas and inferred types.
export { profileSchema, type ProfileOutput } from "./schemas/profile";
export {
  layerContentSchema,
  narrateContentSchema,
  type LayerContent,
  type NarrateContent,
} from "./schemas/content";
export {
  basisEnum,
  evidenceTypeEnum,
  type Basis,
  type EvidenceType,
  type Gap,
} from "./schemas/atoms";
export {
  perceiveOutputSchema,
  hypothesisedLayerSchema,
  confounderOutputSchema,
  confounderSchema,
  confounderVerdictEnum,
  challengeOutputSchema,
  narrateOutputSchema,
  verifiedClaimSchema,
  modelledClaimSchema,
  scoreOutputSchema,
  heroPanelSchema,
  peerBenchmarkSchema,
  supplementBlocksSchema,
  enrichmentOutputSchema,
  type PerceiveOutput,
  type HypothesisedLayer,
  type ConfounderOutput,
  type Confounder,
  type ConfounderVerdict,
  type ChallengeOutput,
  type NarrateOutput,
  type VerifiedClaim,
  type ModelledClaim,
  type ScoreOutput,
  type HeroPanel,
  type PeerBenchmark,
  type SupplementBlocks,
  type EnrichmentOutput,
} from "./schemas/stages";

// Stage runners, telemetry, and the score assembler.
export {
  runProfile,
  runPerceive,
  runHypothesise,
  runConfound,
  runChallenge,
  runNarrate,
  runScore,
  runEnrichment,
  runFindingChallengeConfound,
  runFindingChallengeDecision,
} from "./stages/runners";

// Interactive Challenge (Phase AA): the finding-scoped re-reasoning schemas,
// types, and prompt input. A challenge re-reasons one finding, never a layer.
export {
  findingChallengeConfoundSchema,
  findingChallengeDecisionSchema,
  findingChallengeOutcomeEnum,
  type FindingChallengeConfound,
  type FindingChallengeDecision,
  type FindingChallengeOutcome,
} from "./schemas/findingChallenge";
export { type FindingChallengeInput } from "./prompts/findingChallenge";
export { assembleLayerContent, type AssembleResult } from "./stages/assemble";
export { type StageResult, type StageTelemetry } from "./stages/types";

// Editorial voice quality (Phase AB): a deterministic measurement of an
// assembled layer's prose against a fixed bar. A measurement, never an edit.
export {
  evaluateNarrativeVoice,
  VOICE_BAR,
  type VoiceBand,
  type VoiceCheck,
  type VoiceReport,
} from "./quality/voice";

// The extraction-zone seam (Tier 2, the split pipeline) and the default
// in-boundary adapter. The orchestrator threads StageContext through the Lens
// stages; a future TEE runner implements ExtractionZoneRuntime and is dropped in
// here without touching any stage or orchestrator code.
export {
  DEFAULT_STAGE_CONTEXT,
  type ExtractionRequest,
  type ExtractionResult,
  type ExtractionZoneRuntime,
  type StageContext,
} from "./stages/extractionZone";
export { callLocalJson, getExtractionRuntime, type LocalCallOptions } from "./clients/local";

// Cost model (Phase N): the single place token counts become dollars.
export {
  costUsdForUsage,
  ratesForModel,
  SEAT_RATES,
  LOCAL_RATES,
  WEB_SEARCH_PER_CALL_USD,
  type ModelRates,
  type UsageCounts,
} from "./pricing";
