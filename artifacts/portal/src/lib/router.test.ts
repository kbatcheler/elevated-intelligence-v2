import { describe, expect, it } from "vitest";
import { matchPath, normalizeBase, stripBase, withBase } from "./router";

describe("normalizeBase", () => {
  it("collapses root to an empty prefix", () => {
    expect(normalizeBase("/")).toBe("");
    expect(normalizeBase("")).toBe("");
  });
  it("strips trailing slashes from a sub-path base", () => {
    expect(normalizeBase("/portal/")).toBe("/portal");
    expect(normalizeBase("/portal")).toBe("/portal");
  });
});

describe("stripBase", () => {
  it("returns the path unchanged under a root base", () => {
    expect(stripBase("/layers/finance", "")).toBe("/layers/finance");
    expect(stripBase("/", "")).toBe("/");
  });
  it("removes a matching base prefix", () => {
    expect(stripBase("/portal/layers/finance", "/portal")).toBe("/layers/finance");
    expect(stripBase("/portal", "/portal")).toBe("/");
  });
  it("leaves a non-matching path alone", () => {
    expect(stripBase("/other/page", "/portal")).toBe("/other/page");
  });
  it("does not treat a same-prefix sibling as a base match", () => {
    expect(stripBase("/portalish/x", "/portal")).toBe("/portalish/x");
  });
  it("normalizes an empty pathname to root", () => {
    expect(stripBase("", "")).toBe("/");
  });
});

describe("withBase", () => {
  it("prepends the base and guarantees a leading slash", () => {
    expect(withBase("/layers", "")).toBe("/layers");
    expect(withBase("layers", "")).toBe("/layers");
    expect(withBase("/layers", "/portal")).toBe("/portal/layers");
  });
});

describe("matchPath", () => {
  it("matches a static path", () => {
    expect(matchPath("/layers", "/layers")).toEqual({});
  });
  it("captures a single param", () => {
    expect(matchPath("/layers/:key", "/layers/finance")).toEqual({ key: "finance" });
  });
  it("captures multiple params", () => {
    expect(matchPath("/tenants/:id/layers/:key", "/tenants/abc/layers/finance")).toEqual({
      id: "abc",
      key: "finance",
    });
  });
  it("returns null on a segment-count mismatch", () => {
    expect(matchPath("/layers/:key", "/layers")).toBeNull();
    expect(matchPath("/layers", "/layers/finance")).toBeNull();
  });
  it("returns null when a static segment differs", () => {
    expect(matchPath("/layers/:key", "/reasoning/finance")).toBeNull();
  });
  it("decodes encoded param segments", () => {
    expect(matchPath("/q/:term", "/q/a%20b")).toEqual({ term: "a b" });
  });
  it("treats root as an empty segment list", () => {
    expect(matchPath("/", "/")).toEqual({});
  });
});
