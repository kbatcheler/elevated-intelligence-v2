// The defensive JSON extractor is the only safety net for grounded Gemini
// output, which cannot be pinned to a JSON mime type. These tests cover the
// shapes models actually produce: clean JSON, fenced JSON, and JSON buried in
// prose, plus schema validation failures.

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { extractJsonObject, parseAndValidate, parseJsonLoose, stripJsonFence } from "./json";

describe("stripJsonFence", () => {
  it("removes a json code fence", () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("removes a bare code fence", () => {
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves unfenced text untouched", () => {
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("extractJsonObject", () => {
  it("pulls the object out of surrounding prose", () => {
    expect(extractJsonObject('Here is the JSON: {"a":1, "b":2}. Hope that helps.')).toBe('{"a":1, "b":2}');
  });
  it("returns null when there is no object", () => {
    expect(extractJsonObject("no braces here")).toBeNull();
  });
});

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it("parses fenced JSON", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });
  it("parses JSON wrapped in prose", () => {
    const r = parseJsonLoose('The answer is {"a":1} as requested.');
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });
  it("fails clearly on non-JSON", () => {
    const r = parseJsonLoose("definitely not json");
    expect(r.ok).toBe(false);
  });
});

describe("parseAndValidate", () => {
  const schema = z.object({ name: z.string(), rank: z.number().int().min(1) });

  it("returns the parsed value on a schema match", () => {
    const r = parseAndValidate(schema, '```json\n{"name":"acme","rank":2}\n```');
    expect(r).toEqual({ ok: true, value: { name: "acme", rank: 2 } });
  });
  it("reports a readable reason on a schema miss", () => {
    const r = parseAndValidate(schema, '{"name":"acme","rank":0}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("schema validation failed");
  });
  it("reports a reason when no JSON is present", () => {
    const r = parseAndValidate(schema, "nope");
    expect(r.ok).toBe(false);
  });
});
