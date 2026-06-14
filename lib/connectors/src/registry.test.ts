import { describe, expect, it } from "vitest";
import { db, layersTable } from "@workspace/db";
import { CONNECTOR_FAMILIES, DATA_PATHS } from "./contract";
import { isImplemented, listCatalogue } from "./registry";

// The catalogue is validated against the live layer registry (the single source
// of truth for layer identity), not against a hand-kept constant.
describe("connector catalogue and registry", () => {
  const catalogue = listCatalogue();

  it("declares every connector family", () => {
    const families = new Set(catalogue.map((c) => c.family));
    for (const family of CONNECTOR_FAMILIES) {
      expect(families.has(family)).toBe(true);
    }
  });

  it("has unique connector keys", () => {
    const keys = catalogue.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps every connector to canonical layer keys only", async () => {
    const rows = await db.select({ key: layersTable.key }).from(layersTable);
    const canonical = new Set(rows.map((r) => r.key));
    expect(canonical.size).toBeGreaterThanOrEqual(14);
    for (const connector of catalogue) {
      expect(connector.layers.length).toBeGreaterThan(0);
      for (const layer of connector.layers) {
        expect(canonical.has(layer)).toBe(true);
      }
    }
  });

  it("documents a data path and at least one declared signal per connector", () => {
    for (const connector of catalogue) {
      expect(DATA_PATHS).toContain(connector.path);
      expect(connector.signalsProduced.length).toBeGreaterThan(0);
    }
  });

  it("implements at least two bring-your-own-warehouse reference connectors", () => {
    const implementedWarehouse = catalogue.filter(
      (c) => c.family === "warehouse-bi" && c.implemented,
    );
    expect(implementedWarehouse.length).toBeGreaterThanOrEqual(2);
    for (const connector of implementedWarehouse) {
      expect(isImplemented(connector.key)).toBe(true);
    }
  });

  it("marks declared-but-unimplemented connectors as not implemented", () => {
    const declared = catalogue.filter((c) => !c.implemented);
    expect(declared.length).toBeGreaterThan(0);
    for (const connector of declared) {
      expect(isImplemented(connector.key)).toBe(false);
    }
  });
});
