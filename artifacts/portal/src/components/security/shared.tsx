import React from "react";
import type { TenantSummary } from "../../types";
import { useTenant } from "../../lib/TenantContext";
import { EmptyState, ErrorState, SkeletonLines } from "../primitives";

// One gate every security surface sits behind. It branches on the tenant
// context's real status so the page never spins on a null tenant: loading shows
// a shimmer, error fails loudly with a retry, and an empty roster states the
// plain fact. Children only run once there is a concrete tenant to inspect.
export function TenantGate({
  children,
}: {
  children: (tenantId: string, tenant: TenantSummary) => React.ReactNode;
}) {
  const { status, currentId, current } = useTenant();
  if (status === "loading") return <SkeletonLines lines={6} />;
  if (status === "error") {
    return <ErrorState message="Tenants could not be loaded." onRetry={() => location.reload()} />;
  }
  if (status === "empty" || !currentId || !current) {
    return (
      <EmptyState
        title="No tenant to inspect"
        message="There is no tenant available to you yet. Once one is provisioned it will appear here."
      />
    );
  }
  return <>{children(currentId, current)}</>;
}

// The connection state of a key-management seam, told honestly: a declared but
// unconnected customer KMS reads "Not connected", never a fabricated green.
export function ConnectedPill({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="pill pill-verified">Connected</span>
  ) : (
    <span className="pill pill-amber">Not connected</span>
  );
}

// The lifecycle state of a per-tenant key. A revoked key is shown as revoked,
// never quietly folded into "not provisioned".
export function KeyStatusPill({ status }: { status: "active" | "revoked" | "none" }) {
  if (status === "active") return <span className="pill pill-verified">Active</span>;
  if (status === "revoked") return <span className="pill pill-red">Revoked</span>;
  return <span className="pill pill-gray">Not provisioned</span>;
}
