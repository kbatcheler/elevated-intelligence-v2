import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Connector, ConnectorContext, DerivedSignalSet, ExtractionScope } from "./contract";
import { guardedExtractSignals } from "./guardedExtractSignals";

const nodeRequire = createRequire(import.meta.url);
const TENANT = "11111111-1111-4111-8111-111111111111";

const scope: ExtractionScope = { tenantId: TENANT, connectorKey: "stub", authRef: "REF" };
const ctx: ConnectorContext = {
  resolveSecret: async () => "secret",
  tokenize: (value) => value,
  now: () => new Date("2026-06-14T00:00:00.000Z"),
  log: () => {},
};

function connector(extract: Connector["extractSignals"]): Connector {
  return {
    key: "stub",
    family: "crm-sales",
    deployment: "edge",
    authMethod: "oauth2",
    layers: ["demand"],
    signalsProduced: ["m"],
    extractSignals: extract,
  };
}

const validSet: DerivedSignalSet = {
  source: "stub",
  tenantId: TENANT,
  generatedAt: "2026-06-14T00:00:00.000Z",
  signals: [{ key: "m", kind: "ratio", value: 0.5 }],
};

const probe = path.join(tmpdir(), "ei-guard-probe-" + process.pid + ".txt");

afterEach(() => {
  if (existsSync(probe)) rmSync(probe);
});

describe("guardedExtractSignals", () => {
  it("returns asserted derived math for a well-behaved connector", async () => {
    const { set, nextWatermark } = await guardedExtractSignals(
      connector(async () => validSet),
      scope,
      ctx,
    );
    expect(set.signals).toHaveLength(1);
    expect(set.signals[0]!.value).toBe(0.5);
    expect(nextWatermark).toBeUndefined();
  });

  it("normalizes a wrapper result, returning the asserted set and the next cursor", async () => {
    const { set, nextWatermark } = await guardedExtractSignals(
      connector(async () => ({ set: validSet, nextWatermark: "2026-06-14T00:00:00.000Z" })),
      scope,
      ctx,
    );
    expect(set.signals).toHaveLength(1);
    expect(nextWatermark).toBe("2026-06-14T00:00:00.000Z");
  });

  it("asserts the inner set of a wrapper result, rejecting raw content behind a cursor", async () => {
    const rawSet = {
      source: "stub",
      tenantId: TENANT,
      generatedAt: "2026-06-14T00:00:00.000Z",
      signals: [{ key: "leak", kind: "score", value: "person@example.com" }],
    };
    await expect(
      guardedExtractSignals(
        connector(async () => ({ set: rawSet, nextWatermark: "x" }) as unknown as DerivedSignalSet),
        scope,
        ctx,
      ),
    ).rejects.toThrow(/derive-and-discard/i);
  });

  it("fails a connector that tries to write to disk during extraction, writing nothing", async () => {
    const malicious = connector(async () => {
      // A connector that reaches for the filesystem to persist raw records.
      const fs = nodeRequire("node:fs") as { writeFileSync: (p: string, d: string) => void };
      fs.writeFileSync(probe, "leaked-raw-records");
      return validSet;
    });
    await expect(guardedExtractSignals(malicious, scope, ctx)).rejects.toThrow(/filesystem write/i);
    expect(existsSync(probe)).toBe(false);
  });

  it("fails a connector that returns raw content", async () => {
    const rawSet = {
      source: "stub",
      tenantId: TENANT,
      generatedAt: "2026-06-14T00:00:00.000Z",
      signals: [{ key: "leak", kind: "score", value: "person@example.com" }],
    };
    await expect(
      guardedExtractSignals(
        connector(async () => rawSet as unknown as DerivedSignalSet),
        scope,
        ctx,
      ),
    ).rejects.toThrow(/derive-and-discard/i);
  });

  it("restores the filesystem write surface once extraction is off the stack", async () => {
    await guardedExtractSignals(connector(async () => validSet), scope, ctx);
    const fs = nodeRequire("node:fs") as { writeFileSync: (p: string, d: string) => void };
    fs.writeFileSync(probe, "ok");
    expect(existsSync(probe)).toBe(true);
  });

  it("keeps the guard installed across overlapping extractions", async () => {
    let innerBlocked = false;
    const outer = connector(async () => {
      // A second extraction starts while this one is still on the stack. The
      // guard is reference counted, so the inner write must be blocked too.
      await guardedExtractSignals(
        connector(async () => {
          try {
            (nodeRequire("node:fs") as { writeFileSync: (p: string, d: string) => void }).writeFileSync(
              probe,
              "x",
            );
          } catch {
            innerBlocked = true;
          }
          return validSet;
        }),
        scope,
        ctx,
      );
      return validSet;
    });
    await guardedExtractSignals(outer, scope, ctx);
    expect(innerBlocked).toBe(true);
    expect(existsSync(probe)).toBe(false);
  });
});
