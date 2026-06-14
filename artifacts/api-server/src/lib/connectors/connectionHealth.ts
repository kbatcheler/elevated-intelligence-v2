// Connector health, derived at read time and never stored (Phase O). Storing a
// health column would let it drift from reality between writes; deriving it from
// the connection's last success, last error, and the connector's staleness
// threshold keeps it always honest.

export type ConnectionHealth = "healthy" | "degraded" | "error";

export interface HealthInputs {
  // The stored connection status (for example "connected" or "error").
  status: string | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  // From the connector descriptor: how old the last success may be before the
  // data is considered stale.
  stalenessThresholdSeconds: number;
  now: Date;
}

// Honest precedence:
//  - error:    the connection has been flipped to an error state (a dead
//              connection, a failed token refresh, a persistent extraction
//              failure). This is what fires the transition alert elsewhere.
//  - degraded: connected but not currently trustworthy: it has never succeeded,
//              its last success is older than the staleness threshold, or an
//              error has occurred more recently than the last success.
//  - healthy:  connected with a success inside the staleness window and no newer
//              error.
export function deriveConnectionHealth(input: HealthInputs): ConnectionHealth {
  if (input.status === "error") return "error";

  const { lastSuccessAt, lastErrorAt, now, stalenessThresholdSeconds } = input;

  if (!lastSuccessAt) return "degraded";

  const ageSeconds = (now.getTime() - lastSuccessAt.getTime()) / 1000;
  if (ageSeconds > stalenessThresholdSeconds) return "degraded";

  if (lastErrorAt && lastErrorAt.getTime() > lastSuccessAt.getTime()) return "degraded";

  return "healthy";
}
