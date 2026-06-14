import type { DerivedSignalSet, SignalKind } from "@workspace/db/contracts";

// The uniform connector contract. Defined once, implemented by every connector
// regardless of family. The governing principle is derive and discard: a
// connector touches raw client data, derives insight, and returns only math (a
// DerivedSignalSet). Raw records never appear in a return value and are never
// persisted by us.
export type { DerivedSignalSet, SignalKind };

// The ten connector families from the spec. Stable set, kept as a const so the
// catalogue, the schema enum, and the portal grouping stay in lock step.
export const CONNECTOR_FAMILIES = [
  "accounting-erp",
  "crm-sales",
  "marketing-web-analytics",
  "commerce-pos-inventory",
  "supply-chain-logistics",
  "hris-ats",
  "contracts-documents",
  "support-customer",
  "reputation-social",
  "warehouse-bi",
] as const;
export type ConnectorFamily = (typeof CONNECTOR_FAMILIES)[number];

export const AUTH_METHODS = ["oauth2", "apiKey", "warehouseCredential", "file"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

// edge runs extraction in the in-client agent inside the client network;
// boundary runs it in a self-hosted runtime inside our deployment boundary.
export const DEPLOYMENT_MODES = ["edge", "boundary"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const CONNECTOR_STATUSES = ["available", "beta"] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

// The transit path each connector uses, documented per registry entry so the
// audit story is explicit about where raw client data is touched and that it
// never crosses a third-party aggregator's cloud.
export const DATA_PATHS = ["boundary-runtime", "edge-agent", "file-edge"] as const;
export type DataPath = (typeof DATA_PATHS)[number];

export const DATA_PATH_NOTES: Record<DataPath, string> = {
  "boundary-runtime":
    "A self-hosted runtime inside our deployment boundary connects to the client warehouse with a read-only credential. Raw rows are aggregated in memory and discarded; they never transit a third-party aggregator's cloud.",
  "edge-agent":
    "Authorization is brokered by the framework, but extraction runs in the in-client edge agent inside the client network. Raw records are processed in memory and discarded; only derived signals leave the client boundary.",
  "file-edge":
    "The client delivers a file feed to the in-client edge agent. It is parsed in memory and discarded; only derived signals leave the client boundary.",
};

// A declared derived-signal key, for example "gross_margin_pct". Non identifying.
export type SignalKey = string;

// What to extract. It carries a pointer to the credential (authRef), never the
// credential itself, plus a non-identifying extraction config. There is
// deliberately no database handle and no filesystem path on this type.
export interface ExtractionScope {
  tenantId: string;
  connectorKey: string;
  authRef: string;
  window?: { start: string; end: string };
  config?: Record<string, unknown>;
}

// The capabilities an extraction is given, and nothing more. There is no
// database handle and no filesystem capability, so the extraction path cannot
// persist anything. Writing the returned DerivedSignalSet to our store is the
// caller's job, outside this context. Tokenization replaces identifiers with
// stable non-reversible tokens whose mapping stays inside the client boundary.
export interface ConnectorContext {
  resolveSecret(ref: string): Promise<string>;
  tokenize(value: string): string;
  now(): Date;
  log(event: string, fields?: Record<string, number | string | boolean>): void;
}

// The catalogue metadata for one connector. The catalogue declares every
// connector mapped to the 14 layers, even where the runtime is not implemented.
// A declared-only connector renders as "available, not connected" and never
// fakes data.
export interface ConnectorDescriptor {
  key: string;
  name: string;
  family: ConnectorFamily;
  layers: string[];
  authMethod: AuthMethod;
  deployment: DeploymentMode;
  signalsProduced: SignalKey[];
  status: ConnectorStatus;
  path: DataPath;
  implemented: boolean;
}

// The runtime contract every connector implements. extractSignals is the only
// data path: it computes derived signals from raw client data and returns only
// math.
export interface Connector {
  key: string;
  family: ConnectorFamily;
  layers: string[];
  authMethod: AuthMethod;
  deployment: DeploymentMode;
  signalsProduced: SignalKey[];
  extractSignals(scope: ExtractionScope, ctx: ConnectorContext): Promise<DerivedSignalSet>;
}
