import { describe, expect, it } from "vitest";
import { canonicalKeys, customLayerErrorLabel } from "./customLayerView";

describe("customLayerView.canonicalKeys", () => {
  it("returns the catalog minus the custom layers, preserving order", () => {
    const catalog = [{ key: "demand" }, { key: "supply" }, { key: "my_custom" }, { key: "margin" }];
    const custom = [{ key: "my_custom" }];
    expect(canonicalKeys(catalog, custom)).toEqual(["demand", "supply", "margin"]);
  });

  it("returns every catalog key when there are no custom layers", () => {
    const catalog = [{ key: "demand" }, { key: "supply" }];
    expect(canonicalKeys(catalog, [])).toEqual(["demand", "supply"]);
  });

  it("returns nothing when every catalog layer is custom", () => {
    const catalog = [{ key: "a" }, { key: "b" }];
    expect(canonicalKeys(catalog, [{ key: "a" }, { key: "b" }])).toEqual([]);
  });
});

describe("customLayerView.customLayerErrorLabel", () => {
  it("explains the template requirement on invalid_request", () => {
    expect(customLayerErrorLabel("invalid_request")).toContain("four metric tiles");
  });

  it("explains the benchmark mapping requirement", () => {
    expect(customLayerErrorLabel("invalid_benchmark_canonical_key")).toContain("canonical layer");
  });

  it("falls back to a generic message for an unrecognised code", () => {
    expect(customLayerErrorLabel("nope")).toBe("Failed to create the custom layer.");
  });
});
