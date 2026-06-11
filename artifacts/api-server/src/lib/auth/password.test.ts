import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes to a self-describing scrypt string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const parts = hash.split(":");
    expect(parts[0]).toBe("scrypt");
    expect(parts).toHaveLength(6);
  });

  it("produces a different salt and hash each time", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("s3cret-value");
    expect(await verifyPassword("s3cret-value", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-value");
    expect(await verifyPassword("wrong-value", hash)).toBe(false);
  });

  it("rejects a malformed stored value", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt:bad")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("rejects a tampered hash segment", async () => {
    const hash = await hashPassword("s3cret-value");
    const parts = hash.split(":");
    parts[5] = Buffer.from("tampered-digest").toString("base64");
    expect(await verifyPassword("s3cret-value", parts.join(":"))).toBe(false);
  });
});
