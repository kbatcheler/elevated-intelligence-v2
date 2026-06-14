import { loadEdgeAgentEnv } from "./config";
import { runEdgeCycle } from "./runner";
import { createLocalSecrets } from "./secrets";
import { HttpsAgentTransport } from "./transport";

// The in-client edge agent entrypoint. It runs inside the client network, pulls
// the list of edge connectors it is responsible for, runs each extraction
// locally, and posts only derived math back across the boundary. Raw client
// records never reach our side: derive and discard happens here, in the client's
// own environment.
//
// Trust model. The agent authenticates to the framework API with its per-tenant
// bearer credential, which is the sole trust root. Transport security is mutual
// TLS: in production the API runs behind an mTLS-terminating proxy (for example
// Nginx or Envoy), and this agent presents a client certificate so that proxy
// can require one. The server never trusts a proxy-injected client-certificate
// header; the bearer credential is what authorizes every call. mTLS protects the
// channel, the bearer credential proves identity.
async function main(): Promise<void> {
  const env = loadEdgeAgentEnv();
  const transport = new HttpsAgentTransport({
    baseUrl: env.baseUrl,
    token: env.token,
    tls: env.tls,
  });
  const secrets = createLocalSecrets({ tokenizeSalt: env.tokenizeSalt });

  const result = await runEdgeCycle({
    transport,
    secrets,
    log: (event, fields) => {
      process.stdout.write(JSON.stringify({ event, ...(fields ?? {}) }) + "\n");
    },
  });

  for (const outcome of result.outcomes) {
    process.stdout.write(JSON.stringify({ tenantId: result.tenantId, ...outcome }) + "\n");
  }
}

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? err.stack : err) + "\n");
  process.exitCode = 1;
});
