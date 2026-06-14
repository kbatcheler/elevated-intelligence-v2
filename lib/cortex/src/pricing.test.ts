import { describe, expect, it } from "vitest";
import { SEATS } from "./config";
import {
  costUsdForUsage,
  LOCAL_RATES,
  ratesForModel,
  SEAT_RATES,
  WEB_SEARCH_PER_CALL_USD,
} from "./pricing";

// The model strings live only in config.ts; a test file may reference them via
// SEATS to exercise the seat -> rate resolution.
const reasonerModel = SEATS.reasoner.model;
const evaluatorModel = SEATS.evaluator.model;
const grounderModel = SEATS.grounder.model;

describe("cortex pricing", () => {
  it("resolves each configured seat model to that seat's rates", () => {
    expect(ratesForModel(reasonerModel)).toEqual(SEAT_RATES.reasoner);
    expect(ratesForModel(evaluatorModel)).toEqual(SEAT_RATES.evaluator);
    expect(ratesForModel(grounderModel)).toEqual(SEAT_RATES.grounder);
  });

  it("prices an unknown or self-hosted model at zero (no external charge)", () => {
    expect(ratesForModel("some-self-hosted-model")).toEqual(LOCAL_RATES);
    expect(
      costUsdForUsage({ model: "llama-local", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(0);
  });

  it("prices input and output tokens at the seat's per-MTok rate", () => {
    const cost = costUsdForUsage({
      model: reasonerModel,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(
      SEAT_RATES.reasoner.inputPerMTok + SEAT_RATES.reasoner.outputPerMTok,
      6,
    );
  });

  it("prices cache read and cache write at the cache rates, not the input rate", () => {
    const cost = costUsdForUsage({
      model: reasonerModel,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(
      SEAT_RATES.reasoner.cacheReadPerMTok + SEAT_RATES.reasoner.cacheCreationPerMTok,
      6,
    );
  });

  it("charges per web-search call on top of tokens", () => {
    const cost = costUsdForUsage({ model: reasonerModel, searchCalls: 5 });
    expect(cost).toBeCloseTo(5 * WEB_SEARCH_PER_CALL_USD, 6);
  });

  it("treats missing or null counts as zero, never guessed", () => {
    expect(costUsdForUsage({ model: reasonerModel })).toBe(0);
    expect(
      costUsdForUsage({ model: reasonerModel, inputTokens: null, outputTokens: null }),
    ).toBe(0);
  });

  it("rounds to six decimal places to match the numeric(12,6) ledger column", () => {
    // One input token at $3 per MTok is exactly 0.000003 USD.
    expect(costUsdForUsage({ model: reasonerModel, inputTokens: 1 })).toBe(0.000003);
  });

  it("gives the grounder seat no prompt-cache accounting", () => {
    expect(SEAT_RATES.grounder.cacheReadPerMTok).toBe(0);
    expect(SEAT_RATES.grounder.cacheCreationPerMTok).toBe(0);
    expect(
      costUsdForUsage({
        model: grounderModel,
        cacheReadTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
      }),
    ).toBe(0);
  });
});
