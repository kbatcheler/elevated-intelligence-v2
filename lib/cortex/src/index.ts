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
  modelForStage,
  seatForStage,
  type Provider,
  type SeatKey,
  type SeatConfig,
  type StageName,
  type StageConfig,
  type VerificationChannel,
} from "./config";

// Logger contract.
export { silentLogger, consoleLogger, type Logger, type LogFields } from "./logger";

// JSON extraction utilities.
export { stripJsonFence, extractJsonObject, parseJsonLoose, parseAndValidate } from "./json";

// Grounding.
export {
  fetchHomepageContext,
  isHostnameSafe,
  isPrivateAddress,
  type HomepageContext,
} from "./grounding/homepageContext";

// Prompt-facing descriptor.
export { type LayerDescriptor } from "./prompts/shared";

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
} from "./stages/runners";
export { assembleLayerContent, type AssembleResult } from "./stages/assemble";
export { type StageResult, type StageTelemetry } from "./stages/types";
