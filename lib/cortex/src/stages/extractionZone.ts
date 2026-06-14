// The extraction-zone seam. Tier 2 (the split pipeline) runs the sensitive Lens
// stages (perceive, hypothesise) inside the deployment boundary in connected
// mode, on a self-hosted or open model, so the client's own signals are
// interpreted before anything reaches an external provider. This module defines
// the contract that boundary runtime satisfies; it carries no transport.
//
// TEE SEAM (do not build the TEE now). The cortex depends only on
// ExtractionZoneRuntime, never on how the boundary call is made. The default
// implementation is a plain HTTP adapter to a self-hosted model (clients/local.ts).
// A future confidential-computing runner that runs the same call inside a trusted
// execution environment, with attestation that only approved code touched the
// data, implements THIS interface and is dropped in without touching any stage or
// orchestrator code. That is the whole point of routing every in-boundary call
// through this one seam.

import type { ZodType } from "zod/v4";
import type { CortexDataMode } from "../config";
import type { Logger } from "../logger";

// A single in-boundary model call: the same shape the external clients take,
// narrowed to what the Lens needs. There is deliberately no web-search or tool
// option: the in-boundary Lens grounds on the client's own derived signals, not
// the public web.
export interface ExtractionRequest<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens?: number;
  log?: Logger;
  context?: string;
}

export type ExtractionResult<T> =
  | {
      ok: true;
      value: T;
      durationMs: number;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      ok: false;
      reason: string;
      durationMs: number;
      rawText?: string;
      // Present when a 200 response was received before the failure (a billed
      // call whose output failed schema validation): the tokens were really spent
      // and must still be costed. Absent for a transport error or no-call.
      billed?: boolean;
      inputTokens?: number | null;
      outputTokens?: number | null;
    };

// The boundary runtime a connected-mode Lens stage executes against. `model` and
// `endpoint` are surfaced for telemetry and the audit story (which in-boundary
// model ran, against which host); a secret is never exposed here.
export interface ExtractionZoneRuntime {
  readonly model: string;
  readonly endpoint: string;
  callJson<T>(req: ExtractionRequest<T>): Promise<ExtractionResult<T>>;
}

// Per-run stage context threaded from the orchestrator into the runners. In
// outside_in mode it is the default below and changes nothing: the Lens stays on
// the external reasoner exactly as before. In connected mode dataMode flips to
// "connected" and the Lens routes to extractionRuntime (the configured local
// runtime by default, or an injected one in tests and the future TEE runner).
export interface StageContext {
  dataMode: CortexDataMode;
  extractionRuntime?: ExtractionZoneRuntime;
}

export const DEFAULT_STAGE_CONTEXT: StageContext = { dataMode: "outside_in" };
