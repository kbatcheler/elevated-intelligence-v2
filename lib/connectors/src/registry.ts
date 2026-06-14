import { CATALOGUE, getDescriptor } from "./catalogue";
import { genericSqlConnector, redshiftConnector } from "./connectors/warehouse";
import type { Connector, ConnectorDescriptor } from "./contract";

// The connectors whose runtime is implemented in this phase. Everything else in
// the catalogue is declared but not yet runnable, and is reported honestly as
// "available, not connected".
export const IMPLEMENTED_CONNECTORS: Connector[] = [genericSqlConnector, redshiftConnector];

const IMPLEMENTED_BY_KEY = new Map<string, Connector>(
  IMPLEMENTED_CONNECTORS.map((c) => [c.key, c]),
);

export function listCatalogue(): ConnectorDescriptor[] {
  return CATALOGUE;
}

export function isImplemented(key: string): boolean {
  return IMPLEMENTED_BY_KEY.has(key);
}

// Return the runnable connector for a key, or fail loudly. A declared-but-not
// implemented connector throws an honest "available, not connected" error rather
// than returning a stub that could fake data.
export function getConnector(key: string): Connector {
  const connector = IMPLEMENTED_BY_KEY.get(key);
  if (connector) {
    return connector;
  }
  if (getDescriptor(key)) {
    throw new Error(
      "Connector " + key + " is available, not connected: its runtime is not implemented yet.",
    );
  }
  throw new Error("Unknown connector: " + key);
}
