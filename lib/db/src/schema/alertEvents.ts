import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// One operational alert event (Phase O onward). This is the alert SEAM: a
// connector transition to error or a failed OAuth token refresh records one
// honest row here, and the Phase P notifier consumes the pending rows and
// delivers them to a sink (Slack or a generic webhook). Nothing sensitive is
// stored: an operator-facing message and a small sanitized details object,
// never a secret value and never any raw client data.
//
// Like model_usage, the row is decoupled from the tenant lifecycle: it is an
// operational ledger, so tenantId nulls out on a tenant delete rather than
// cascading the alert history away.
export const alertTypeEnum = pgEnum("alert_event_type", [
  // Emitted in Phase O.
  "connector_error_transition",
  "oauth_refresh_failed",
  // Declared now so the Phase P notifier and its emitters need no enum
  // migration. Phase O emits only the two above; later phases wire the rest.
  "budget_threshold",
  "break_glass_used",
  "provenance_integrity_failed",
  "seed_run_failed",
]);

export const alertSeverityEnum = pgEnum("alert_event_severity", ["info", "warning", "critical"]);

export const alertNotificationStatusEnum = pgEnum("alert_notification_status", [
  "pending",
  "sent",
  "suppressed",
  "failed",
]);

export const alertEventsTable = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: alertTypeEnum("type").notNull(),
    severity: alertSeverityEnum("severity").notNull().default("warning"),
    // The tenant this alert concerns, or null for a global alert or after the
    // tenant is deleted (the alert history is kept for the audit).
    tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
    // The connector this alert concerns, if any. A plain label, no foreign key,
    // so the alert outlives any connection row it references.
    connectorKey: text("connector_key"),
    // What the alert is about (for example "connection") and the id of that
    // entity, so a notifier can group and a console can link. Never a secret.
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    // Operator-facing summary, written to be safe to forward to a chat sink: no
    // secret value, no raw client record.
    message: text("message").notNull(),
    // A small, sanitized structured payload (codes, counts, timestamps). The
    // emitter is responsible for keeping this free of secrets and raw data.
    details: jsonb("details"),
    // Delivery state for the Phase P notifier. A new row is pending until the
    // notifier delivers it (sent), declines it (suppressed), or fails (failed).
    notificationStatus: alertNotificationStatusEnum("notification_status")
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("alert_events_created_idx").on(t.createdAt),
    statusIdx: index("alert_events_status_idx").on(t.notificationStatus),
  }),
);

export type AlertEventRow = typeof alertEventsTable.$inferSelect;
export type InsertAlertEvent = typeof alertEventsTable.$inferInsert;
