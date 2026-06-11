import { describe, expect, it } from "vitest";
import { canonicalizePinCode, generatePinCode, hashPinCode, pinState } from "./pin";

const SECRET = "test-session-secret";
const AMBIGUOUS = /[01OI]/;
const SHAPE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

describe("PIN code generation", () => {
  it("produces four groups of four from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePinCode();
      expect(code).toMatch(SHAPE);
      expect(code).not.toMatch(AMBIGUOUS);
    }
  });
});

describe("PIN canonicalization", () => {
  it("normalizes lowercase, spaces and missing dashes to one form", () => {
    expect(canonicalizePinCode("abcd efgh jklm 2345")).toBe("ABCD-EFGH-JKLM-2345");
    expect(canonicalizePinCode("ABCDEFGHJKLM2345")).toBe("ABCD-EFGH-JKLM-2345");
    expect(canonicalizePinCode("abcd-efgh-jklm-2345")).toBe("ABCD-EFGH-JKLM-2345");
  });

  it("rejects codes of the wrong length", () => {
    expect(canonicalizePinCode("ABCD-EFGH")).toBeNull();
    expect(canonicalizePinCode("")).toBeNull();
    expect(canonicalizePinCode("ABCD-EFGH-JKLM-2345-EXTRA")).toBeNull();
  });

  it("round-trips a generated code unchanged", () => {
    const code = generatePinCode();
    expect(canonicalizePinCode(code)).toBe(code);
  });
});

describe("PIN hashing", () => {
  it("is deterministic for a given code and secret", () => {
    const code = "ABCD-EFGH-JKLM-2345";
    expect(hashPinCode(code, SECRET)).toBe(hashPinCode(code, SECRET));
  });

  it("changes with the secret, so secret rotation invalidates PINs", () => {
    const code = "ABCD-EFGH-JKLM-2345";
    expect(hashPinCode(code, SECRET)).not.toBe(hashPinCode(code, "other-secret"));
  });

  it("differs across codes", () => {
    expect(hashPinCode("ABCD-EFGH-JKLM-2345", SECRET)).not.toBe(
      hashPinCode("WXYZ-EFGH-JKLM-2345", SECRET),
    );
  });
});

describe("PIN state machine", () => {
  const now = new Date("2026-06-11T00:00:00Z");
  const base = { revokedAt: null as Date | null, expiresAt: new Date("2026-06-25T00:00:00Z"), useCount: 0, maxUses: 1 };

  it("is active when unused, unexpired and not revoked", () => {
    expect(pinState(base, now)).toBe("active");
  });

  it("is revoked when revokedAt is set, taking precedence", () => {
    expect(pinState({ ...base, revokedAt: new Date("2026-06-10T00:00:00Z") }, now)).toBe("revoked");
  });

  it("is expired once past expiresAt", () => {
    expect(pinState({ ...base, expiresAt: new Date("2026-06-10T00:00:00Z") }, now)).toBe("expired");
  });

  it("is used-up when useCount reaches maxUses", () => {
    expect(pinState({ ...base, useCount: 1, maxUses: 1 }, now)).toBe("used-up");
  });
});
