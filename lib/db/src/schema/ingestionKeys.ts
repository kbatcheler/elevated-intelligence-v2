import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenantsTable } from "./tenants";

// A per-tenant ingestion credential for the public Ingestion API (/v1/ingest)
// and the MCP server (Phase AE). It follows exactly the edge_agents discipline:
// the row id is the public key id carried in the bearer token, and only the
// scrypt hash of the secret half is stored, never the secret itself, so a leak
// of this table cannot be replayed against the API. The secret is shown to the
// operator exactly once, at issue time, and is unrecoverable afterwards. The
// middleware loads the row fresh on every call, so revoking a key takes effect
// on its very next request.
export const ingestionKeyStatusEnum = pgEnum("ingestion_key_status", ["active", "revoked"]);

export const ingestionKeysTable = pgTable("ingestion_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  // The scrypt hash of the credential secret, never the secret itself.
  tokenHash: text("token_hash").notNull(),
  status: ingestionKeyStatusEnum("status").notNull().default("active"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertIngestionKeySchema = createInsertSchema(ingestionKeysTable);

export type IngestionKey = typeof ingestionKeysTable.$inferSelect;
export type InsertIngestionKey = typeof ingestionKeysTable.$inferInsert;
