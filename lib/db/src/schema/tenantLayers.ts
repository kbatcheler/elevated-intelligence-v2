import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { layersTable } from "./layers";
import { tenantsTable } from "./tenants";

// Per-tenant generated layer content. The layerKey references the registry, so
// content is always tied to a known layer. The confounders column persists the
// genuine Confounder sub-stage output (ranked confounders with mechanisms,
// directional impacts and ruled-out verdicts); it is populated by the cortex
// and nullable until that stage has run.
export const tenantLayersTable = pgTable(
  "tenant_layers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    layerKey: text("layer_key")
      .notNull()
      .references(() => layersTable.key, { onDelete: "restrict" }),
    content: jsonb("content").notNull().$type<Record<string, unknown>>(),
    heroPanel: jsonb("hero_panel").$type<Record<string, unknown> | null>(),
    peerBenchmark: jsonb("peer_benchmark").$type<Record<string, unknown> | null>(),
    supplementBlocks: jsonb("supplement_blocks").$type<Record<string, unknown> | null>(),
    confounders: jsonb("confounders").$type<unknown[] | null>(),
    verifiedClaims: jsonb("verified_claims").$type<Record<string, unknown> | null>(),
    modelledClaims: jsonb("modelled_claims").$type<Record<string, unknown> | null>(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    generatorModel: text("generator_model").notNull(),
  },
  (t) => [unique("tenant_layers_tenant_id_layer_key_unique").on(t.tenantId, t.layerKey)],
);

export type TenantLayer = typeof tenantLayersTable.$inferSelect;
export type InsertTenantLayer = typeof tenantLayersTable.$inferInsert;
