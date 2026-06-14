import { alertEventsTable, alertSeverityEnum, alertTypeEnum, db } from "@workspace/db";
import type { InsertAlertEvent } from "@workspace/db";
import { logger } from "../logger";

// The alert SEAM (Phase O). Operational events that an operator must know about
// (a connector turning to error, a failed OAuth refresh) are emitted through
// this one interface. In Phase O the default implementation records each event
// as a pending row in alert_events and logs its routing fields. Phase P adds a
// notifier that consumes the pending rows and delivers them to a sink (Slack or
// a generic webhook). Consumers depend on this interface, never on the sink, so
// wiring the sink later touches nothing here.

// The type and severity vocabularies are derived from the schema enums so the
// code and the table can never drift apart.
export type AlertType = (typeof alertTypeEnum.enumValues)[number];
export type AlertSeverity = (typeof alertSeverityEnum.enumValues)[number];

// A small, sanitized structured payload. Scalars only, by construction, so an
// emitter cannot accidentally attach a secret object or a raw client record.
export type AlertDetails = Record<string, string | number | boolean | null>;

export interface AlertEvent {
  type: AlertType;
  severity: AlertSeverity;
  tenantId?: string | null;
  connectorKey?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  // Operator-facing summary. Must be safe to forward to a chat sink: no secret
  // value, no raw client record.
  message: string;
  details?: AlertDetails;
}

export interface Alerter {
  emit(event: AlertEvent): Promise<void>;
}

// The default alerter: record one pending row, then log only the routing fields
// (type, severity, ids), never the message body or details, which an operator
// reads from the alert_events row rather than the application log.
export class DbAlerter implements Alerter {
  async emit(event: AlertEvent): Promise<void> {
    const row: InsertAlertEvent = {
      type: event.type,
      severity: event.severity,
      tenantId: event.tenantId ?? null,
      connectorKey: event.connectorKey ?? null,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      message: event.message,
      details: event.details ?? null,
    };
    await db.insert(alertEventsTable).values(row);

    const fields = {
      alertType: event.type,
      severity: event.severity,
      connectorKey: event.connectorKey ?? undefined,
      tenantId: event.tenantId ?? undefined,
      entityType: event.entityType ?? undefined,
      entityId: event.entityId ?? undefined,
    };
    if (event.severity === "critical") logger.error(fields, "alert recorded");
    else if (event.severity === "warning") logger.warn(fields, "alert recorded");
    else logger.info(fields, "alert recorded");
  }
}

let activeAlerter: Alerter | null = null;

/** Returns the process-wide Alerter, constructing the default on first use. */
export function getAlerter(): Alerter {
  if (!activeAlerter) {
    activeAlerter = new DbAlerter();
  }
  return activeAlerter;
}

/** Test seam: override the active alerter (pass null to reset to the default). */
export function setAlerter(alerter: Alerter | null): void {
  activeAlerter = alerter;
}
