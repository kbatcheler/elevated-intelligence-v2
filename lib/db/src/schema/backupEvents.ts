import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Backups and disaster recovery audit (Phase U). One honest row per real backup
// action that actually wrote an object: a provenance ledger archive exported to
// durable object storage. A tick that finds nothing new writes no row, mirroring
// the retention audit, so the audit never fills with empty sweeps.
//
// Like retention_events, the row is decoupled from the user lifecycle: the
// authorityUserId nulls out on a delete rather than cascading the audit history
// away, because a backup audit must outlive the operator who triggered it. There
// is deliberately no tenant column: the ledger archive is a whole-system,
// cross-tenant export, not a per-tenant action.
export const backupActionEnum = pgEnum("backup_action", ["ledger_archive"]);

export const backupEventsTable = pgTable(
  "backup_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: backupActionEnum("action").notNull(),
    // The object storage key the archive was written to, and the store provider
    // keyword (for example "local" or "gcs"). Never a credential, never a bucket
    // secret, never the archived content.
    objectKey: text("object_key").notNull(),
    storeProvider: text("store_provider").notNull(),
    // A sha256 over the canonical archive bytes, so a later read can confirm the
    // object was not altered, and so an unchanged ledger is detected and skipped
    // rather than re-archived every tick.
    sha256: text("sha256").notNull(),
    entryCount: integer("entry_count").notNull().default(0),
    tenantCount: integer("tenant_count").notNull().default(0),
    // Whether every tenant chain in the archived ledger re-verified at export
    // time, so the archive is known to hold an intact chain copy, not assumed to.
    chainVerified: boolean("chain_verified").notNull().default(false),
    // The human who triggered a manual archive. Null for a scheduled run, whose
    // authority is the system scheduler itself (authorityRole "system").
    authorityUserId: uuid("authority_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    authorityRole: text("authority_role").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("backup_events_created_idx").on(t.createdAt),
  }),
);

export type BackupEventRow = typeof backupEventsTable.$inferSelect;
export type InsertBackupEvent = typeof backupEventsTable.$inferInsert;
