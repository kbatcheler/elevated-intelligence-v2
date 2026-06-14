import { readFileSync } from "node:fs";
import { type Server, createServer } from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDerivedSignalSet } from "@workspace/connectors";
import type { Connector, DerivedSignalSet } from "@workspace/connectors";
import { runEdgeCycle } from "./runner";
import { createLocalSecrets } from "./secrets";
import { HttpsAgentTransport } from "./transport";

// A real mutual-TLS handshake over loopback, exercised with the exact transport
// the production agent uses. The server requires a client certificate; the agent
// presents one. This proves the agent can complete mTLS and that a client with
// no certificate is rejected at the handshake, not waved through. No live
// connector runs: a stub edge connector returns a DerivedSignalSet, which is the
// edge half of the persistence seam, and the server captures exactly what the
// agent posts so we can assert it is math, not raw records.
const dir = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string): Buffer => readFileSync(path.join(dir, "..", "test", "fixtures", name));

const caCert = fx("ca.crt");
const serverCert = fx("server.crt");
const serverKey = fx("server.key");
const clientCert = fx("client.crt");
const clientKey = fx("client.key");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EDGE_KEY = "stub-edge";

// What the connector returns: derived math only. A scalar ratio and a numeric
// vector, never a raw record.
const PRODUCED: DerivedSignalSet = {
  source: EDGE_KEY,
  tenantId: TENANT_ID,
  generatedAt: "2026-06-14T00:00:00.000Z",
  signals: [
    { key: "pipeline_velocity", kind: "ratio", value: 0.61, window: "P30D", unit: "ratio" },
    { key: "stage_distribution", kind: "distribution", value: [4, 2, 1] },
  ],
};

function stubConnector(): Connector {
  return {
    key: EDGE_KEY,
    family: "crm-sales",
    layers: ["demand"],
    authMethod: "oauth2",
    deployment: "edge",
    signalsProduced: ["pipeline_velocity", "stage_distribution"],
    async extractSignals() {
      return PRODUCED;
    },
  };
}

let server: Server;
let base: string;
const captured: { authorized: boolean[]; signals: unknown[]; bearer: string[] } = {
  authorized: [],
  signals: [],
  bearer: [],
};

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  server = createServer(
    { cert: serverCert, key: serverKey, ca: caCert, requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      void (async (): Promise<void> => {
        // The TLS layer authorized the peer certificate before any handler runs.
        const authorized = (req.socket as import("node:tls").TLSSocket).authorized;
        captured.authorized.push(authorized);
        captured.bearer.push(req.headers.authorization ?? "");

        const url = req.url ?? "";
        if (req.method === "POST" && url === "/api/agent/register") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, agentId: "agent-1", tenantId: TENANT_ID, label: null }));
          return;
        }
        if (req.method === "GET" && url === "/api/agent/config") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              tenantId: TENANT_ID,
              connectors: [
                {
                  connectorKey: EDGE_KEY,
                  authRef: "STUB_EDGE_REF",
                  scopeConfig: null,
                  layers: ["demand"],
                  deployment: "edge",
                },
              ],
            }),
          );
          return;
        }
        if (req.method === "POST" && url === "/api/agent/signals") {
          const body = JSON.parse(await readBody(req));
          captured.signals.push(body);
          res.writeHead(202, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ ok: true, runId: "run-1", signalsCount: body.signals.length, provenanceRootHash: "deadbeef" }),
          );
          return;
        }
        res.writeHead(404).end();
      })();
    },
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      base = `https://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("edge agent mTLS transport", () => {
  it("completes a mutual-TLS handshake and posts only derived math", async () => {
    const transport = new HttpsAgentTransport({
      baseUrl: base,
      token: "agent-1.secret",
      tls: { cert: clientCert, key: clientKey, ca: caCert },
    });
    const secrets = createLocalSecrets({ tokenizeSalt: "local-salt", env: {} });

    const result = await runEdgeCycle({
      transport,
      secrets,
      getConnector: () => stubConnector(),
      isImplemented: () => true,
    });

    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      connectorKey: EDGE_KEY,
      status: "posted",
      signalsCount: 2,
    });

    // The server saw an authorized client certificate on every call: mTLS held.
    expect(captured.authorized.length).toBeGreaterThanOrEqual(3);
    expect(captured.authorized.every((a) => a === true)).toBe(true);
    expect(captured.bearer.every((b) => b === "Bearer agent-1.secret")).toBe(true);

    // What landed on the server is a valid DerivedSignalSet: math, not records.
    expect(captured.signals).toHaveLength(1);
    const posted = assertDerivedSignalSet(captured.signals[0]);
    expect(posted.source).toBe(EDGE_KEY);
    expect(posted.signals.map((s) => s.key)).toEqual(["pipeline_velocity", "stage_distribution"]);
  });

  it("rejects a client that presents no certificate", async () => {
    const transport = new HttpsAgentTransport({
      baseUrl: base,
      token: "agent-1.secret",
      // No client cert or key: the server requires one, so the handshake fails.
      tls: { ca: caCert },
    });
    await expect(transport.register()).rejects.toThrow();
  });
});
