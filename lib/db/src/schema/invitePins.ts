import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { userRoleEnum, usersTable } from "./users";

// PIN-gated self-registration. PINs are minted only by the owner, shown once,
// single-use by default, expiring and revocable. Only a hash of the code is
// stored, never the plaintext. Scoped PINs onboard a user into a specific org
// and role, which is native here because orgs exist from day one.
export const invitePinsTable = pgTable("invite_pins", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Hash of the PIN code (scrypt or bcrypt). Never the plaintext.
  codeHash: text("code_hash").unique().notNull(),
  label: text("label"),
  maxUses: integer("max_uses").notNull().default(1),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  // Scoped PIN target. When set, registering with this PIN places the user in
  // this org with this role. Null for an unscoped provider-member PIN.
  scopeOrgId: uuid("scope_org_id").references(() => orgsTable.id, { onDelete: "set null" }),
  scopeRole: userRoleEnum("scope_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InvitePin = typeof invitePinsTable.$inferSelect;
export type InsertInvitePin = typeof invitePinsTable.$inferInsert;
