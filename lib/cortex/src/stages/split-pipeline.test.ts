// The Tier 2 split: in connected mode the two Lens stages (perceive, hypothesise)
// run in-boundary on the local seat; in outside_in mode they stay external and
// the call path is unchanged. Proven with an injected ExtractionZoneRuntime so no
// live model of any kind is required.

import { describe, expect, it, vi } from "vitest";

// Keep the suite hermetic: the outside_in path would otherwise make a real
// external model call. We only need to prove routing (that outside_in never
// consults the local runtime), so stub the external client to return instantly.
vi.mock("../clients/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../clients/anthropic")>();
  return {
    ...actual,
    callClaudeJson: vi.fn(() =>
      Promise.resolve({ ok: false as const, reason: "stubbed external seat (not invoked in this test)", durationMs: 0 }),
    ),
  };
});

import { runHypothesise, runPerceive } from "./runners";
import type { ExtractionRequest, ExtractionResult, ExtractionZoneRuntime, StageContext } from "./extractionZone";
import { silentLogger } from "../logger";
import type { LayerDescriptor, LayerGrounding } from "../prompts/shared";
import type { ProfileOutput } from "../schemas/profile";
import type { HypothesisedLayer, PerceiveOutput } from "../schemas/stages";

const profile: ProfileOutput = {
  name: "Acme Industrial",
  url: "https://acme.example",
  sector: "Industrial Manufacturing",
  logoMonogram: "AC",
};

const layer: LayerDescriptor = {
  key: "demand",
  name: "Demand",
  description: "How demand is forming across the pipeline.",
  diagnosticQuestion: "Is demand strengthening or softening, and why?",
};

// Derived-signal grounding is math-only by construction (numbers, units, windows,
// provenance) and never raw connector content; this is what the in-boundary Lens
// grounds on, and the same block the external seats would later see.
const grounding: LayerGrounding = {
  layerKey: "demand",
  signals: [
    {
      signalKey: "pipeline_velocity_ratio",
      value: 1.42,
      unit: "x",
      window: "90d",
      sourceConnectorKey: "crm",
      computedAt: "2026-06-01T00:00:00Z",
    },
  ],
};

const perceiveValue = { signals: [], named_entities: [], sector_context: "" } as unknown as PerceiveOutput;
const hypothesisedValue = { content: {} } as unknown as HypothesisedLayer;

// A recording runtime: captures every in-boundary request and returns a fixed
// value, standing in for the local seat (and the future TEE runner).
function recordingRuntime<T>(value: T, model = "local-boundary-model"): ExtractionZoneRuntime & {
  calls: ExtractionRequest<unknown>[];
} {
  const calls: ExtractionRequest<unknown>[] = [];
  return {
    model,
    endpoint: "http://boundary.local/v1/chat/completions",
    calls,
    callJson<R>(req: ExtractionRequest<R>): Promise<ExtractionResult<R>> {
      calls.push(req as ExtractionRequest<unknown>);
      return Promise.resolve({
        ok: true,
        value: value as unknown as R,
        durationMs: 3,
        model,
        inputTokens: 5,
        outputTokens: 9,
      });
    },
  };
}

describe("connected mode routes the Lens in-boundary", () => {
  it("perceive runs on the injected local runtime, not externally", async () => {
    const runtime = recordingRuntime(perceiveValue);
    const ctx: StageContext = { dataMode: "connected", extractionRuntime: runtime };
    const res = await runPerceive(profile, layer, silentLogger, grounding, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output).toBe(perceiveValue);
    // Telemetry honestly records the in-boundary model that actually ran.
    expect(res.telemetry.model).toBe("local-boundary-model");
    expect(res.telemetry.seat).toBe("Lens");
    expect(runtime.calls).toHaveLength(1);
    // The in-boundary request carries the same math-only grounding block, never
    // any raw connector content.
    expect(runtime.calls[0]?.user).toContain("pipeline_velocity_ratio");
  });

  it("hypothesise runs on the injected local runtime", async () => {
    const runtime = recordingRuntime(hypothesisedValue);
    const ctx: StageContext = { dataMode: "connected", extractionRuntime: runtime };
    const res = await runHypothesise(profile, layer, perceiveValue, silentLogger, grounding, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output).toBe(hypothesisedValue);
    expect(res.telemetry.model).toBe("local-boundary-model");
    expect(runtime.calls).toHaveLength(1);
  });
});

describe("connected mode fails loud when the local seat is unconfigured", () => {
  it("perceive returns 'available, not connected' with no runtime and no env", async () => {
    const prevBase = process.env["LOCAL_MODEL_BASE_URL"];
    const prevModel = process.env["LOCAL_MODEL_MODEL"];
    delete process.env["LOCAL_MODEL_BASE_URL"];
    delete process.env["LOCAL_MODEL_MODEL"];
    try {
      const ctx: StageContext = { dataMode: "connected" };
      const res = await runPerceive(profile, layer, silentLogger, grounding, ctx);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toContain("available, not connected");
      // Never a silent external fallback: the failure is explicit.
      expect(res.telemetry.model).toContain("not connected");
    } finally {
      if (prevBase !== undefined) process.env["LOCAL_MODEL_BASE_URL"] = prevBase;
      if (prevModel !== undefined) process.env["LOCAL_MODEL_MODEL"] = prevModel;
    }
  });
});

describe("outside_in mode is unchanged (never touches the local runtime)", () => {
  it("does not call the injected runtime even when one is present", async () => {
    const runtime = recordingRuntime(perceiveValue);
    const spy = vi.spyOn(runtime, "callJson");
    const ctx: StageContext = { dataMode: "outside_in", extractionRuntime: runtime };
    // The external path runs (and returns 'not configured' without API keys in the
    // test env); the contract under test is only that the local runtime is never
    // consulted in outside_in mode.
    await runPerceive(profile, layer, silentLogger, grounding, ctx);
    expect(spy).not.toHaveBeenCalled();
    expect(runtime.calls).toHaveLength(0);
  });
});
