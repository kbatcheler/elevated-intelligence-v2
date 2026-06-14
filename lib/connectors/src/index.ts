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
export { assertDerivedSignalSet, isDerivedSignalSet, SIGNAL_KINDS } from "@workspace/db/contracts";
