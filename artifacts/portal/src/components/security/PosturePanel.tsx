import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { KeyStatus, KmsStatus } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { fetchKeyStatus, provisionTenantKey, revokeTenantKey } from "../../lib/securityApi";
import { ErrorState, SectionHeading, SkeletonLines } from "../primitives";
import { formatDateTime } from "../primitives/format";
import { ConnectedPill, KeyStatusPill } from "./shared";
import { ConnectorHealthSection } from "./ConnectorHealthSection";

type State =
  | { kind: "loading" }
  | { kind: "ready"; key: KeyStatus }
  | { kind: "error" };

// The owner's view of a tenant's encryption posture: the per-tenant key and the
// two key-management seams. Provisioning is idempotent; revoking crypto-shreds
// the tenant's signals, so it is gated behind an explicit confirm. Every figure
// is read from the live key status; nothing here is assumed.
export function PosturePanel({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setActionError("");
    setConfirmRevoke(false);
    const out = await fetchKeyStatus(tenantId);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) return setState({ kind: "error" });
    setState({ kind: "ready", key: out.data });
  }, [tenantId, logout]);

  useEffect(() => {
    load();
  }, [load]);

  const provision = async () => {
    setBusy(true);
    setActionError("");
    const out = await provisionTenantKey(tenantId);
    setBusy(false);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) {
      setActionError(out.error === "tenant_not_found" ? "Tenant not found." : "Provisioning failed.");
      return;
    }
    load();
  };

  const revoke = async () => {
    setBusy(true);
    setActionError("");
    setConfirmRevoke(false);
    const out = await revokeTenantKey(tenantId);
    setBusy(false);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) {
      setActionError(out.error === "no_key_to_revoke" ? "There is no key to revoke." : "Revoke failed.");
      return;
    }
    load();
  };

  if (state.kind === "loading") return <SkeletonLines lines={6} />;
  if (state.kind === "error") {
    return <ErrorState message="The security posture could not be loaded." onRetry={load} />;
  }

  const { key } = state;

  return (
    <div className="grid gap-7">
      <div className="card">
        <SectionHeading eyebrow="Encryption" title="Per-tenant data key" />
        <div className="flex items-center gap-3 flex-wrap">
          <KeyStatusPill status={key.status} />
          {key.status === "revoked" && key.revokedAt && (
            <span className="text-caption text-slate-base">Revoked {formatDateTime(key.revokedAt)}</span>
          )}
        </div>
        <p className="text-[14px] text-slate-base mt-3.5 mb-0 leading-normal max-w-[640px]">
          {key.status === "active" &&
            "A per-tenant key encrypts this tenant's human signals at rest. Revoking it crypto-shreds the data: the ciphertext remains but can never be decrypted again."}
          {key.status === "revoked" &&
            "This tenant's key has been revoked. The encrypted signals are crypto-shredded and cannot be decrypted. Provision a new key to encrypt signals computed from here on."}
          {key.status === "none" &&
            "No key has been provisioned for this tenant yet. Provision one to encrypt human signals at rest."}
        </p>
        {actionError && (
          <div className="alert-error mt-4">
            <span>{actionError}</span>
          </div>
        )}
        <div className="flex gap-2.5 mt-[18px] flex-wrap items-center">
          {key.status !== "active" && (
            <button className="btn-primary" onClick={provision} disabled={busy}>
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : key.status === "revoked" ? (
                "Provision new key"
              ) : (
                "Provision key"
              )}
            </button>
          )}
          {key.status === "active" && !confirmRevoke && (
            <button className="btn-ghost" onClick={() => setConfirmRevoke(true)} disabled={busy}>
              Revoke key (crypto-shred)
            </button>
          )}
          {key.status === "active" && confirmRevoke && (
            <>
              <span className="text-caption text-coral-ink font-semibold">
                This permanently shreds this tenant's signals. Continue?
              </span>
              <button className="btn-primary bg-coral" onClick={revoke} disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : "Yes, revoke"}
              </button>
              <button className="btn-ghost" onClick={() => setConfirmRevoke(false)} disabled={busy}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <SectionHeading eyebrow="Key management" title="Key management service" />
        <div className="grid grid-cols-2 gap-4">
          <KmsCard title="Active KMS" kms={key.kms} />
          <KmsCard title="Customer-managed KMS" kms={key.customerKms} />
        </div>
      </div>

      <ConnectorHealthSection tenantId={tenantId} />
    </div>
  );
}

function KmsCard({ title, kms }: { title: string; kms: KmsStatus }) {
  return (
    <div className="card grid gap-2.5">
      <div className="eyebrow text-gold-ink">
        {title}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[14px] text-navy">
          {kms.provider}
        </span>
        <ConnectedPill connected={kms.connected} />
      </div>
      <div className="text-caption text-slate-base leading-normal">{kms.detail}</div>
    </div>
  );
}
