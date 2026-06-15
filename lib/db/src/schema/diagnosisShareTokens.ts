import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

// Sellability Pack (Phase AB). A read-only, shareable diagnosis link for one
// tenant. The opaque token is shown to the minter exactly ONCE and is never
// persisted; only its sha256 hash is stored, so a database read can never
// reconstruct a working link. The public read surface resolves a request by
// hashing the presented token and matching this row, attaching ONLY the tenant
// id, never a user session. Privacy is structural: an unexpired, unrevoked row
// is required, the scope is bounded by privacyLevel, and every link carries a
// hard expiry (an absent expiry is never "forever").
//
// The only posture supported today is summary_only: the board-pack-level
// projection (headline, lead metric, narrative, top move, top gap, confidence,
// voice band), never the full causes/hypotheses/proof arrays, raw connector
// data, provenance, or any user identity. The enum leaves room for a future
// fuller posture without a code change at the call sites that read it.
export const diagnosisSharePrivacyEnum = pgEnum("diagnosis_share_privacy", ["summary_only"]);

export const diagnosisShareTokensTable = pgTable(
  "diagnosis_share_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // sha256 hex of the opaque token. Unique so a presented token resolves to at
    // most one share. The token itself never lands in a column.
    tokenHash: text("token_hash").notNull().unique(),
    privacyLevel: diagnosisSharePrivacyEnum("privacy_level").notNull().default("summary_only"),
    // Who minted the link. Set null (not cascade) on a user delete so the share
    // and its access log survive the operator being removed, mirroring the audit
    // tables.
    createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    // An optional human label for the operator's own list ("Acme board deck").
    label: text("label"),
    // Every link expires. Enforced at read time, not just displayed.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set when an operator revokes the link early; a revoked link reads as gone.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Real access telemetry, updated on every successful public read. Never a
    // fabricated figure: a link that has not been opened shows null and 0.
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("diagnosis_share_tokens_tenant_idx").on(t.tenantId),
  }),
);

export type DiagnosisShareToken = typeof diagnosisShareTokensTable.$inferSelect;
export type InsertDiagnosisShareToken = typeof diagnosisShareTokensTable.$inferInsert;
export type DiagnosisSharePrivacy = DiagnosisShareToken["privacyLevel"];
