import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertDerivedSignalSet } from "@workspace/db/contracts";
import type { Connector, ConnectorContext, ExtractionScope } from "./contract";

// A context with no database handle and no filesystem capability, used to drive a
// connector through its boundary guard.
const ctx: ConnectorContext = {
  async resolveSecret() {
    return "";
  },
  tokenize: (value) => "tok_" + value.length.toString(),
  now: () => new Date(),
  log: () => {},
};

const scope: ExtractionScope = {
  tenantId: randomUUID(),
  connectorKey: "leaky",
  authRef: "unused",
};

// A connector that tries to return a raw client record. The boundary guard must
// reject it so the run fails loudly rather than persisting reversible data.
const leakyConnector: Connector = {
  key: "leaky",
  family: "warehouse-bi",
  layers: ["finance"],
  authMethod: "warehouseCredential",
  deployment: "boundary",
  signalsProduced: ["customer_email"],
  async extractSignals(s) {
    return assertDerivedSignalSet({
      source: "leaky",
      tenantId: s.tenantId,
      generatedAt: new Date().toISOString(),
      signals: [{ key: "customer_email", kind: "score", value: "ada@acme.example" }],
    });
  },
};

describe("connector boundary guard", () => {
  it("rejects a connector that returns a raw string value", async () => {
    await expect(leakyConnector.extractSignals(scope, ctx)).rejects.toThrow(/derive-and-discard/);
  });

  it("rejects extra raw fields smuggled onto a signal", () => {
    expect(() =>
      assertDerivedSignalSet({
        source: "x",
        tenantId: randomUUID(),
        generatedAt: new Date().toISOString(),
        signals: [{ key: "k", kind: "score", value: 1, note: "raw record" }],
      }),
    ).toThrow(/derive-and-discard/);
  });

  it("accepts a clean numeric signal set", () => {
    const ok = assertDerivedSignalSet({
      source: "x",
      tenantId: randomUUID(),
      generatedAt: new Date().toISOString(),
      signals: [{ key: "k", kind: "score", value: 0.5 }],
    });
    expect(ok.signals.length).toBe(1);
  });
});
