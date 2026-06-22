import { CATALOGUE, getDescriptor } from "./catalogue";
import { googleAnalytics4Connector } from "./connectors/googleAnalytics4";
import { hubspotConnector } from "./connectors/hubspot";
import { quickbooksOnlineConnector } from "./connectors/quickbooksOnline";
import { salesforceConnector } from "./connectors/salesforce";
import { shopifyConnector } from "./connectors/shopify";
import { genericSqlConnector, redshiftConnector } from "./connectors/warehouse";
import { zendeskConnector } from "./connectors/zendesk";
import type { Connector, ConnectorDescriptor } from "./contract";

// The connectors whose runtime is implemented. Everything else in the catalogue
// is declared but not yet runnable, and is reported honestly as "available, not
// connected". The bring-your-own-warehouse pair speak SQL over node-postgres; the
// six priority connectors speak their provider's public HTTP API with no SDK.
export const IMPLEMENTED_CONNECTORS: Connector[] = [
  genericSqlConnector,
  redshiftConnector,
  salesforceConnector,
  hubspotConnector,
  quickbooksOnlineConnector,
  googleAnalytics4Connector,
  shopifyConnector,
  zendeskConnector,
];

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
