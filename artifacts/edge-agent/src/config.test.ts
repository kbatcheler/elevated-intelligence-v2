import { describe, it, expect } from "vitest";
import { loadEdgeAgentEnv } from "./config.js";

// A complete, valid environment except for the base URL, which each case overrides.
// No TLS files are referenced so loadEdgeAgentEnv does not touch the filesystem.
function baseEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    EI_AGENT_TOKEN: "agent-token",
    EI_AGENT_TOKENIZE_SALT: "salt",
    ...overrides,
  };
}

describe("edge agent base URL transport enforcement", () => {
  it("accepts an https base URL", () => {
    const env = baseEnv({ EI_API_BASE_URL: "https://api.example.com" });
    expect(loadEdgeAgentEnv(env).baseUrl).toBe("https://api.example.com");
  });

  it("accepts plain http only for a loopback host", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const env = baseEnv({ EI_API_BASE_URL: "http://" + host + ":3001" });
      expect(loadEdgeAgentEnv(env).baseUrl).toBe("http://" + host + ":3001");
    }
  });

  it("rejects plain http to a remote host so the bearer is never sent in clear", () => {
    const env = baseEnv({ EI_API_BASE_URL: "http://api.example.com" });
    expect(() => loadEdgeAgentEnv(env)).toThrow(/must be https/);
  });

  it("allows remote http only behind the explicit test opt-out", () => {
    const env = baseEnv({
      EI_API_BASE_URL: "http://api.example.com",
      EI_AGENT_INSECURE_HTTP: "1",
    });
    expect(loadEdgeAgentEnv(env).baseUrl).toBe("http://api.example.com");
  });

  it("rejects a non-http(s) scheme", () => {
    const env = baseEnv({ EI_API_BASE_URL: "ftp://api.example.com" });
    expect(() => loadEdgeAgentEnv(env)).toThrow(/http or https/);
  });

  it("rejects a malformed base URL", () => {
    const env = baseEnv({ EI_API_BASE_URL: "not a url" });
    expect(() => loadEdgeAgentEnv(env)).toThrow(/not a valid URL/);
  });
});
