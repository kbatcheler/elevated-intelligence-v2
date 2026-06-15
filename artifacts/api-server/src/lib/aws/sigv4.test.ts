import { afterEach, describe, expect, it } from "vitest";
import { resolveAwsCredentials, signRequestV4 } from "./sigv4";

// The signer is pinned against AWS's own published Signature Version 4 example
// (the IAM ListUsers request from the AWS General Reference), so a regression in
// the canonicalisation or the signing-key derivation turns this red rather than
// emitting a silently invalid signature. The remaining cases pin the properties
// the two adapters depend on.

const CREDS = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const FIXED = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));

describe("signRequestV4 golden vector (AWS published IAM ListUsers example)", () => {
  it("reproduces the documented signature exactly", () => {
    const signed = signRequestV4({
      method: "GET",
      url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
      region: "us-east-1",
      service: "iam",
      credentials: CREDS,
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      now: FIXED,
    });
    expect(signed.signedHeaders).toBe("content-type;host;x-amz-date");
    expect(signed.credentialScope).toBe("20150830/us-east-1/iam/aws4_request");
    expect(signed.signature).toBe("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
    expect(signed.authorization).toContain("Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request");
    expect(signed.headers.Authorization).toBe(signed.authorization);
    expect(signed.headers["X-Amz-Date"]).toBe("20150830T123600Z");
    // The empty-payload SHA256, the well-known value for a bodyless request.
    expect(signed.payloadHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("signRequestV4 canonicalisation properties", () => {
  it("single-encodes the path for s3 and double-encodes for other services", () => {
    const s3 = signRequestV4({
      method: "GET",
      url: "https://s3.amazonaws.com/bucket/a:b",
      region: "us-east-1",
      service: "s3",
      credentials: CREDS,
      now: FIXED,
    });
    const other = signRequestV4({
      method: "GET",
      url: "https://host.amazonaws.com/bucket/a:b",
      region: "us-east-1",
      service: "execute-api",
      credentials: CREDS,
      now: FIXED,
    });
    expect(s3.canonicalRequest.split("\n")[1]).toBe("/bucket/a%3Ab");
    expect(other.canonicalRequest.split("\n")[1]).toBe("/bucket/a%253Ab");
  });

  it("sorts the canonical query string by key then value", () => {
    const signed = signRequestV4({
      method: "GET",
      url: "https://host/x?b=2&a=1&a=0",
      region: "r",
      service: "s",
      credentials: CREDS,
      now: FIXED,
    });
    expect(signed.canonicalRequest.split("\n")[2]).toBe("a=0&a=1&b=2");
  });

  it("signs host, x-amz-date, a session token, and content sha256, sorted and lower-cased", () => {
    const signed = signRequestV4({
      method: "POST",
      url: "https://host/path",
      region: "r",
      service: "secretsmanager",
      credentials: { ...CREDS, sessionToken: "SESSIONTOKEN" },
      headers: { "X-Amz-Target": "Svc.Op", "Content-Type": "application/x-amz-json-1.1" },
      payload: Buffer.from("{}", "utf8"),
      addContentSha256Header: true,
      now: FIXED,
    });
    expect(signed.signedHeaders).toBe(
      "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-target",
    );
    expect(signed.headers["X-Amz-Security-Token"]).toBe("SESSIONTOKEN");
    expect(signed.headers["X-Amz-Content-Sha256"]).toBe(signed.payloadHash);
  });

  it("hashes the real payload rather than using UNSIGNED-PAYLOAD", () => {
    const signed = signRequestV4({
      method: "PUT",
      url: "https://host/k",
      region: "r",
      service: "s3",
      credentials: CREDS,
      payload: Buffer.from("hello", "utf8"),
      addContentSha256Header: true,
      now: FIXED,
    });
    // SHA256("hello").
    expect(signed.payloadHash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(signed.headers["X-Amz-Content-Sha256"]).toBe(signed.payloadHash);
  });

  it("includes If-None-Match in the signed headers for a write-once put", () => {
    const signed = signRequestV4({
      method: "PUT",
      url: "https://host/k",
      region: "r",
      service: "s3",
      credentials: CREDS,
      headers: { "If-None-Match": "*" },
      payload: Buffer.from("x", "utf8"),
      addContentSha256Header: true,
      now: FIXED,
    });
    expect(signed.signedHeaders.split(";")).toContain("if-none-match");
    expect(signed.headers["If-None-Match"]).toBe("*");
  });

  it("is deterministic for the same inputs and changes when the payload changes", () => {
    const base = { method: "PUT", url: "https://host/k", region: "r", service: "s3", credentials: CREDS, now: FIXED };
    const a = signRequestV4({ ...base, payload: Buffer.from("one", "utf8") });
    const b = signRequestV4({ ...base, payload: Buffer.from("one", "utf8") });
    const c = signRequestV4({ ...base, payload: Buffer.from("two", "utf8") });
    expect(a.signature).toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
  });
});

describe("resolveAwsCredentials", () => {
  const KEYS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];
  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("throws a precise error when the keys are unset", () => {
    for (const k of KEYS) delete process.env[k];
    expect(() => resolveAwsCredentials()).toThrow(/AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY/);
  });

  it("returns override credentials including an optional session token", () => {
    expect(resolveAwsCredentials({ accessKeyId: "a", secretAccessKey: "b", sessionToken: "t" })).toEqual({
      accessKeyId: "a",
      secretAccessKey: "b",
      sessionToken: "t",
    });
  });
});
