// Typography enforcement for generated content. The long-dash ban is a hard
// constraint across code, copy, and data. The generation prompts instruct the
// models to avoid the long dash (see prompts/shared.ts), but models still emit
// one occasionally, so this is the deterministic enforcement applied to every
// generated string before it is persisted. The em-dash (U+2014) becomes a
// spaced ASCII hyphen, the en-dash (U+2013) becomes a plain ASCII hyphen, which
// keeps numeric ranges readable. ASCII hyphens, model identifiers, and numbers
// are left untouched.

const EM_DASH = /\s*\u2014\s*/g;
const EN_DASH = /\u2013/g;

// Normalize the long dashes in a single string to ASCII.
export function stripDashes(input: string): string {
  return input.replace(EM_DASH, " - ").replace(EN_DASH, "-");
}

// Recursively normalize every string inside a value, preserving structure and
// leaving numbers, booleans, and null untouched. The return type mirrors the
// input so callers keep their static types.
export function deepStripDashes<T>(value: T): T {
  if (typeof value === "string") {
    return stripDashes(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepStripDashes(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepStripDashes(val);
    }
    return out as unknown as T;
  }
  return value;
}
