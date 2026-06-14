import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// The retention and deletion audit (Phase S). One honest row per real
// retention action: a scheduled TTL purge of derived signals past their
// configured age, or an operator-authorized tenant erasure. This is the
// "what, when, authority" evidence the SOC 2 retention control needs.
//
// Like alert_events and model_usage, the row is decoupled from the tenant and
// user lifecycle: tenantId and authorityUserId null out on a delete rather than
// cascading the audit history away, because the whole point of a retention
// audit is that it outlives the data it describes.
export const retentionActionEnum = pgEnum("retention_action", ["ttl_purge", "tenant_erasure"]);

export const retentionEventsTable = pgTable(
  "retention_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The tenant whose signals were purged or erased. Null for a global sweep
    // bucket or after the tenant is deleted; the audit row is retained.
    tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
    action: retentionActionEnum("action").notNull(),
    // The human who authorized an erasure. Null for a scheduled TTL purge, whose
    // authority is the system scheduler itself (authorityRole "system").
    authorityUserId: uuid("authority_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // The role recorded at the time of the action, kept verbatim so the audit is
    // readable even after the user row is gone.
    authorityRole: text("authority_role").notNull(),
    // What was in scope, scalars only: { ttlDays, cutoff } for a purge,
    // { scope, count } for an erasure. Never a secret and never raw data.
    scope: jsonb("scope"),
    deletedDerivedSignalCount: integer("deleted_derived_signal_count").notNull().default(0),
    // The provenance ledger redaction entry an erasure appended, so the audit
    // links to the tamper-evident record. Null for a TTL purge (no redaction).
    // A pointer, not a foreign key, so it stays valid as the append-only ledger
    // grows and is never coupled to the ledger's own lifecycle.
    redactionLedgerEntryId: uuid("redaction_ledger_entry_id"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("retention_events_tenant_idx").on(t.tenantId),
    createdIdx: index("retention_events_created_idx").on(t.createdAt),
  }),
);

export type RetentionEventRow = typeof retentionEventsTable.$inferSelect;
export type InsertRetentionEvent = typeof retentionEventsTable.$inferInsert;
