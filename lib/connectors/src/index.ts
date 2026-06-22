// The connector framework: one uniform contract, a full catalogue mapped to the
// 14 layers, and the implemented reference connectors. The DerivedSignalSet
// contract and its guard live in @workspace/db/contracts and are re-exported
// here for convenience. Importing this package never touches the application
// database, because it imports the contract subpath only, never the db root.
export * from "./contract";
export { CATALOGUE, getDescriptor } from "./catalogue";
export {
  IMPLEMENTED_CONNECTORS,
  listCatalogue,
  isImplemented,
  getConnector,
} from "./registry";
export {
  createWarehouseConnector,
  redshiftConnector,
  genericSqlConnector,
} from "./connectors/warehouse";
export type { WarehouseMeasure } from "./connectors/warehouse";
// The six priority HTTP connectors. Each speaks its provider's public API over
// the Node global fetch with no SDK, reducing raw data to declared signals.
export { salesforceConnector } from "./connectors/salesforce";
export { hubspotConnector } from "./connectors/hubspot";
export { quickbooksOnlineConnector } from "./connectors/quickbooksOnline";
export { googleAnalytics4Connector } from "./connectors/googleAnalytics4";
export { shopifyConnector } from "./connectors/shopify";
export { zendeskConnector } from "./connectors/zendesk";
// The shared HTTP substrate and the throttle signal it raises. The throttle
// class lives here so the connector that throws it and the api-server runtime
// that retries it share one class identity.
export { ConnectorThrottleError, httpJson, httpRequestJson, nextLink } from "./httpJson";
export type { HttpJsonRequest, HttpJsonResult, QueryValue } from "./httpJson";
export { guardedExtractSignals } from "./guardedExtractSignals";
export { assertDerivedSignalSet, isDerivedSignalSet, SIGNAL_KINDS } from "@workspace/db/contracts";
