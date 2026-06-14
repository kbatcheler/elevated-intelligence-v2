import { request as httpRequest } from "node:http";
import { type RequestOptions, request as httpsRequest } from "node:https";
import { URL } from "node:url";
import type { DerivedSignalSet } from "@workspace/connectors";

// The agent's only channel to the framework API. It speaks the per-tenant bearer
// credential on every call (the sole trust root) and, over https, presents a
// client certificate so an mTLS-terminating proxy in front of the API can
// require one. No raw client data ever travels this channel: the only payload
// the agent sends is a DerivedSignalSet, which is derived math.

export interface AgentTlsOptions {
  cert?: string | Buffer;
  key?: string | Buffer;
  ca?: string | Buffer;
  rejectUnauthorized?: boolean;
}

// One connector the agent is responsible for, as returned by /config. authRef is
// a pointer the agent resolves against its own local secret store; it is never a
// secret value.
export interface AgentConnectorConfig {
  connectorKey: string;
  authRef: string;
  scopeConfig: Record<string, unknown> | null;
  layers: string[];
  deployment: string;
}

export interface AgentConfig {
  tenantId: string;
  connectors: AgentConnectorConfig[];
}

export interface RegisterResult {
  ok: boolean;
  agentId: string;
  tenantId: string;
  label: string | null;
}

export interface IngestResult {
  ok: boolean;
  runId: string;
  signalsCount: number;
  provenanceRootHash: string;
}

export interface AgentTransport {
  register(): Promise<RegisterResult>;
  pullConfig(): Promise<AgentConfig>;
  postSignals(set: DerivedSignalSet): Promise<IngestResult>;
}

interface HttpResponse {
  status: number;
  body: string;
}

export class HttpsAgentTransport implements AgentTransport {
  private readonly base: URL;
  private readonly token: string;
  private readonly tls: AgentTlsOptions;

  constructor(opts: { baseUrl: string; token: string; tls?: AgentTlsOptions }) {
    this.base = new URL(opts.baseUrl);
    this.token = opts.token;
    this.tls = opts.tls ?? {};
  }

  register(): Promise<RegisterResult> {
    return this.json<RegisterResult>("POST", "/api/agent/register");
  }

  pullConfig(): Promise<AgentConfig> {
    return this.json<AgentConfig>("GET", "/api/agent/config");
  }

  postSignals(set: DerivedSignalSet): Promise<IngestResult> {
    return this.json<IngestResult>("POST", "/api/agent/signals", set);
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        "agent transport " + method + " " + path + " failed: " + res.status + " " + res.body,
      );
    }
    return JSON.parse(res.body) as T;
  }

  private send(method: string, path: string, body?: unknown): Promise<HttpResponse> {
    const url = new URL(path, this.base);
    const isHttps = url.protocol === "https:";
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));

    const headers: Record<string, string> = {
      authorization: "Bearer " + this.token,
      accept: "application/json",
    };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(payload.length);
    }

    const options: RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };
    if (isHttps) {
      options.cert = this.tls.cert;
      options.key = this.tls.key;
      options.ca = this.tls.ca;
      options.rejectUnauthorized = this.tls.rejectUnauthorized ?? true;
    }

    return new Promise<HttpResponse>((resolve, reject) => {
      const handle = (res: import("node:http").IncomingMessage): void => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      };
      const req = isHttps ? httpsRequest(options, handle) : httpRequest(options, handle);
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
