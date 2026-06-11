import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The layer registry. This table is the single source of truth for layer
// identity. There is no LAYER_KEYS constant anywhere in the system: the
// pipeline, schemas, prompts and portal all read layer identity from here. The
// 14 canonicals are seeded from this registry; custom layers are added as more
// rows later, and the data model already supports them.

// The metric tiles a business person wants at a glance (the four-tile spec).
export type LayerMetricDefinitions = {
  tiles: string[];
};

// The gaps the layer exposes in the client's own operation, with the single
// Different Day capability that closes them.
export type LayerGaps = {
  items: string[];
  closedBy: string;
};

export const layersTable = pgTable("layers", {
  // The stable business key, for example "business-performance". Primary key so
  // per-tenant tables can reference it directly.
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  // The full archetype label from the layer content specification, for example
  // "Performance scorecard" or "Performance scorecard, benchmark variant".
  archetype: text("archetype").notNull(),
  // How the hero visualization renders for this archetype.
  heroDescription: text("hero_description").notNull(),
  ownerPersona: text("owner_persona").notNull(),
  diagnosticQuestion: text("diagnostic_question").notNull(),
  metricDefinitions: jsonb("metric_definitions").notNull().$type<LayerMetricDefinitions>(),
  rootCauses: jsonb("root_causes").notNull().$type<string[]>(),
  actions: jsonb("actions").notNull().$type<string[]>(),
  gaps: jsonb("gaps").notNull().$type<LayerGaps>(),
  feeds: jsonb("feeds").notNull().$type<string[]>(),
  // The Different Day capability module this layer rolls up into.
  moduleGroup: text("module_group").notNull(),
  // Generation prompt fragments. Populated by the cortex phase; nullable here so
  // the registry seeds cleanly before prompts are wired.
  promptFragments: jsonb("prompt_fragments").$type<Record<string, unknown> | null>(),
  isCanonical: boolean("is_canonical").notNull().default(true),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Layer = typeof layersTable.$inferSelect;
export type InsertLayer = typeof layersTable.$inferInsert;
