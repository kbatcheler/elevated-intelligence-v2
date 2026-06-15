import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_ARCHETYPES } from "./customLayer";

// The API-side allowed-archetype list and the portal hero registry have no shared
// package they can both import without adding a dependency, so they are kept in
// lockstep by this guard rather than by a runtime import: it reads the portal
// registry source and asserts the renderable archetype labels exactly match
// ALLOWED_ARCHETYPES. A new hero, a renamed archetype, or a removed one on either
// side fails here, so a custom layer can never be offered an archetype the portal
// cannot render, and vice versa.
const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(
  here,
  "../../../../portal/src/components/heroes/registry.ts",
);

function registryArchetypeKeys(): string[] {
  const src = readFileSync(registryPath, "utf8");
  const start = src.indexOf("const REGISTRY");
  expect(start).toBeGreaterThanOrEqual(0);
  const block = src.slice(start, src.indexOf("};", start));
  return [...block.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]!);
}

describe("custom layer archetype sync", () => {
  it("mirrors the portal hero registry exactly", () => {
    const keys = registryArchetypeKeys();
    expect(keys.length).toBeGreaterThan(0);
    // Same set, and no duplicates on the portal side.
    expect(new Set(keys)).toEqual(new Set(ALLOWED_ARCHETYPES));
    expect(keys.length).toBe(ALLOWED_ARCHETYPES.length);
  });
});
