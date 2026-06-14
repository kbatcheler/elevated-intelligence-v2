import { readFileSync } from "node:fs";
import { URL } from "node:url";

// Configuration for the in-client agent, read from its own local environment.
// The base URL points at the framework API (in production, at the mTLS proxy in
// front of it). The token is the per-tenant bearer credential. The TLS material
// is the agent's client certificate, key and the CA that signed the server, so
// the agent can complete a mutual-TLS handshake.

export interface EdgeAgentEnv {
  baseUrl: string;
  token: string;
  tokenizeSalt: string;
  tls: {
    cert?: Buffer;
    key?: Buffer;
    ca?: Buffer;
    rejectUnauthorized: boolean;
  };
}

function required(name: string, env: Record<string, string | undefined>): string {
  const value = env[name];
  if (!value) {
    throw new Error("Edge agent requires " + name + " to be set in the local environment");
  }
  return value;
}

function maybeFile(p: string | undefined): Buffer | undefined {
  return p ? readFileSync(p) : undefined;
}

// The agent sends its bearer credential on every call, so the base URL must be
// HTTPS or the token would travel in clear. Plain http is allowed only for a
// loopback host (local development against the dev server) or behind an explicit
// EI_AGENT_INSECURE_HTTP=1 opt-out for tests, never silently in production.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function enforceSecureBaseUrl(raw: string, env: Record<string, string | undefined>): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Edge agent EI_API_BASE_URL is not a valid URL: " + raw);
  }
  if (url.protocol === "https:") return raw;
  if (url.protocol === "http:") {
    if (LOOPBACK_HOSTS.has(url.hostname) || env.EI_AGENT_INSECURE_HTTP === "1") return raw;
    throw new Error(
      "Edge agent EI_API_BASE_URL must be https so the bearer credential is not sent in clear; " +
        "plain http is allowed only for a loopback host or with an explicit EI_AGENT_INSECURE_HTTP=1 opt-out.",
    );
  }
  throw new Error("Edge agent EI_API_BASE_URL must use http or https, got " + url.protocol);
}

export function loadEdgeAgentEnv(
  env: Record<string, string | undefined> = process.env,
): EdgeAgentEnv {
  return {
    baseUrl: enforceSecureBaseUrl(required("EI_API_BASE_URL", env), env),
    token: required("EI_AGENT_TOKEN", env),
    tokenizeSalt: required("EI_AGENT_TOKENIZE_SALT", env),
    tls: {
      cert: maybeFile(env.EI_AGENT_TLS_CERT),
      key: maybeFile(env.EI_AGENT_TLS_KEY),
      ca: maybeFile(env.EI_AGENT_TLS_CA),
      // Always verify the server by default; only an explicit local opt-out
      // disables it, and never silently.
      rejectUnauthorized: env.EI_AGENT_TLS_INSECURE === "1" ? false : true,
    },
  };
}
