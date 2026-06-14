import {
  type Connector,
  type ConnectorContext,
  type ExtractionScope,
  getConnector as defaultGetConnector,
  guardedExtractSignals,
  isImplemented as defaultIsImplemented,
} from "@workspace/connectors";
import type { LocalSecrets } from "./secrets";
import type { AgentTransport } from "./transport";

// One run of the agent: register, pull the list of edge connectors this tenant
// is responsible for, run each extraction locally, and post only the derived
// math back. Declared-but-unimplemented connectors are reported honestly and
// never faked. Persistence is never done here; the framework caller persists
// what the agent posts. Dependencies are injected so the cycle can be driven in
// a test with a stub connector over a real mTLS loopback.

export type EdgeConnectorOutcome =
  | { connectorKey: string; status: "posted"; signalsCount: number; runId: string }
  | { connectorKey: string; status: "available_not_connected" }
  | { connectorKey: string; status: "skipped_not_edge" }
  | { connectorKey: string; status: "error"; reason: string };

export interface EdgeCycleResult {
  tenantId: string;
  outcomes: EdgeConnectorOutcome[];
}

export interface RunnerDeps {
  transport: AgentTransport;
  secrets: LocalSecrets;
  getConnector?: (key: string) => Connector;
  isImplemented?: (key: string) => boolean;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, number | string | boolean>) => void;
}

export async function runEdgeCycle(deps: RunnerDeps): Promise<EdgeCycleResult> {
  const getConnector = deps.getConnector ?? defaultGetConnector;
  const isImplemented = deps.isImplemented ?? defaultIsImplemented;
  const now = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? ((): void => {});

  await deps.transport.register();
  const config = await deps.transport.pullConfig();
  const outcomes: EdgeConnectorOutcome[] = [];

  for (const entry of config.connectors) {
    // The framework only hands the agent edge connectors, but guard anyway: the
    // agent must never run a boundary connector.
    if (entry.deployment !== "edge") {
      outcomes.push({ connectorKey: entry.connectorKey, status: "skipped_not_edge" });
      continue;
    }

    // Honest handling: a declared connector with no runtime is reported as
    // available, not connected. Nothing is fabricated.
    if (!isImplemented(entry.connectorKey)) {
      log("connector_available_not_connected", { connectorKey: entry.connectorKey });
      outcomes.push({ connectorKey: entry.connectorKey, status: "available_not_connected" });
      continue;
    }

    try {
      const connector = getConnector(entry.connectorKey);
      const scope: ExtractionScope = {
        tenantId: config.tenantId,
        connectorKey: entry.connectorKey,
        authRef: entry.authRef,
        config: entry.scopeConfig ?? undefined,
      };
      const ctx: ConnectorContext = {
        resolveSecret: (ref) => deps.secrets.resolveSecret(ref),
        tokenize: (value) => deps.secrets.tokenize(value),
        now,
        log,
      };
      // The connector touches raw client data here, in the client network, and
      // returns only math. The raw records are discarded with the function frame.
      // The guard blocks any filesystem write during extraction and asserts the
      // result is derive-and-discard math before it leaves the client.
      // The edge agent never extracts incrementally, so it forwards only the
      // asserted math and ignores any watermark.
      const { set } = await guardedExtractSignals(connector, scope, ctx);
      const result = await deps.transport.postSignals(set);
      outcomes.push({
        connectorKey: entry.connectorKey,
        status: "posted",
        signalsCount: result.signalsCount,
        runId: result.runId,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log("connector_extract_failed", { connectorKey: entry.connectorKey });
      outcomes.push({ connectorKey: entry.connectorKey, status: "error", reason });
    }
  }

  return { tenantId: config.tenantId, outcomes };
}
