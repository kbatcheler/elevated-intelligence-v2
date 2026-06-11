import {
  boolean,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { layersTable } from "./layers";
import { tenantsTable } from "./tenants";

// Per-tenant layer configuration: enable or disable a layer, rename it within
// the tenant's vocabulary, reorder it, and reweight what the cross-layer
// narrator emphasises. The configuration model is native from foundations; the
// custom-layer creation UI comes later, the data model does not.
export const tenantLayerConfigTable = pgTable(
  "tenant_layer_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    layerKey: text("layer_key")
      .notNull()
      .references(() => layersTable.key, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    // Tenant-local rename. Null means use the registry name.
    displayName: text("display_name"),
    // Tenant-local order. Null means use the registry sortOrder.
    sortOrder: integer("sort_order"),
    // Narrator emphasis weight. Null means default weighting.
    weight: real("weight"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("tenant_layer_config_tenant_id_layer_key_unique").on(t.tenantId, t.layerKey)],
);

export type TenantLayerConfig = typeof tenantLayerConfigTable.$inferSelect;
export type InsertTenantLayerConfig = typeof tenantLayerConfigTable.$inferInsert;
