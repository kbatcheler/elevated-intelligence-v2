import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { AccessEvent, AdminUser, Grant } from "../../types";
import { useAuth } from "../../lib/AuthContext";
import { fetchUsers } from "../../lib/adminApi";
import { createGrant, fetchAccessEvents, fetchGrants, revokeGrant } from "../../lib/securityApi";
import { SectionHeading } from "../primitives";
import { formatDateTime } from "../primitives/format";

type ListState<T> =
  | { kind: "loading" }
  | { kind: "ready"; items: T[] }
  | { kind: "empty" }
  | { kind: "error" };

// A grant's live state derived from its timestamps: revoked beats expired beats
// active. Only an active grant can be revoked, and only an active grant unlocks
// the human signal read.
function grantStatus(g: Grant): { label: string; cls: string; active: boolean } {
  if (g.revokedAt) return { label: "Revoked", cls: "pill-red", active: false };
  if (new Date(g.expiresAt).getTime() <= Date.now()) return { label: "Expired", cls: "pill-gray", active: false };
  return { label: "Active", cls: "pill-verified", active: true };
}

// The owner's break-glass administration: issue a time-boxed grant to a specific
// user with a recorded reason, see every grant and its live state, and read the
// append-only audit of every access made under those grants.
export function BreakGlassAdminPanel({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [grants, setGrants] = useState<ListState<Grant>>({ kind: "loading" });
  const [events, setEvents] = useState<ListState<AccessEvent>>({ kind: "loading" });
  const [users, setUsers] = useState<ListState<AdminUser>>({ kind: "loading" });

  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresInMinutes, setExpiresInMinutes] = useState(60);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [revokeError, setRevokeError] = useState("");

  const loadGrants = useCallback(async () => {
    const out = await fetchGrants(tenantId);
    if ("unauthorized" in out) return void logout();
    if (out.state === "error") return setGrants({ kind: "error" });
    setGrants(out.state === "empty" ? { kind: "empty" } : { kind: "ready", items: out.items });
  }, [tenantId, logout]);

  const loadEvents = useCallback(async () => {
    const out = await fetchAccessEvents(tenantId);
    if ("unauthorized" in out) return void logout();
    if (out.state === "error") return setEvents({ kind: "error" });
    setEvents(out.state === "empty" ? { kind: "empty" } : { kind: "ready", items: out.items });
  }, [tenantId, logout]);

  const loadUsers = useCallback(async () => {
    setUsers({ kind: "loading" });
    const out = await fetchUsers();
    if ("unauthorized" in out) return void logout();
    if (out.state === "error") return setUsers({ kind: "error" });
    setUsers(out.state === "empty" ? { kind: "empty" } : { kind: "ready", items: out.items });
  }, [logout]);

  useEffect(() => {
    setGrants({ kind: "loading" });
    setEvents({ kind: "loading" });
    setRevokeError("");
    loadGrants();
    loadEvents();
    loadUsers();
  }, [loadGrants, loadEvents, loadUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!userId) {
      setFormError("Select a user to grant access to.");
      return;
    }
    if (!reason.trim()) {
      setFormError("A reason is required for the audit record.");
      return;
    }
    setCreating(true);
    const out = await createGrant(tenantId, { userId, reason: reason.trim(), expiresInMinutes });
    setCreating(false);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) {
      setFormError(
        out.error === "user_not_found"
          ? "That user no longer exists."
          : out.error === "invalid_input"
            ? "Check the reason and the duration (1 to 1440 minutes)."
            : "Failed to create the grant.",
      );
      return;
    }
    setReason("");
    setUserId("");
    setExpiresInMinutes(60);
    loadGrants();
    loadEvents();
  };

  const handleRevoke = async (grantId: string) => {
    setRevokeError("");
    const out = await revokeGrant(grantId);
    if ("unauthorized" in out) return void logout();
    if ("error" in out) {
      setRevokeError("That grant could not be revoked. It may already be revoked or expired; refresh to confirm.");
      return;
    }
    loadGrants();
    loadEvents();
  };

  const userList = users.kind === "ready" ? users.items : [];
  const userLabel = (id: string) => {
    const u = userList.find((x) => x.id === id);
    return u ? u.displayName || u.email : id.slice(0, 8);
  };

  return (
    <div className="grid gap-8">
      <div className="card card-accent-gold">
        <h3 className="font-serif text-title font-semibold text-navy mb-4">
          Grant break-glass access
        </h3>
        {formError && (
          <div className="alert-error mb-4">
            <span>{formError}</span>
          </div>
        )}
        <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4 items-end">
          <div>
            <label className="label-base">User</label>
            {users.kind === "loading" ? (
              <div className="skeleton h-[38px]" />
            ) : users.kind === "error" ? (
              <div className="text-caption text-red-base py-[9px]">
                The user list could not be loaded.{" "}
                <button
                  type="button"
                  className="btn-ghost h-6 px-2 text-meta"
                  onClick={loadUsers}
                >
                  Retry
                </button>
              </div>
            ) : users.kind === "empty" ? (
              <div className="text-caption text-slate-light py-[9px]">
                No users are available to grant access to.
              </div>
            ) : (
              <select className="input-base" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select a user...</option>
                {users.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.displayName || u.email) + " (" + u.role + ")"}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="label-base">Expires in (minutes)</label>
            <input
              type="number"
              min={1}
              max={1440}
              className="input-base"
              value={expiresInMinutes}
              onChange={(e) => setExpiresInMinutes(parseInt(e.target.value) || 1)}
            />
          </div>
          <div className="col-span-full">
            <label className="label-base">Reason (recorded in the audit log)</label>
            <input
              className="input-base"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Incident 1423: investigate signal anomaly"
              maxLength={500}
            />
          </div>
          <div className="col-span-full flex justify-end">
            <button type="submit" className="btn-primary" disabled={creating || users.kind !== "ready"}>
              {creating ? <Loader2 size={16} className="animate-spin" /> : "Grant access"}
            </button>
          </div>
        </form>
      </div>

      <div>
        <SectionHeading eyebrow="Standing grants" title="Break-glass grants" />
        {revokeError && (
          <div className="alert-error mb-4">
            <span>{revokeError}</span>
          </div>
        )}
        <GrantsTable state={grants} onRevoke={handleRevoke} userLabel={userLabel} />
      </div>

      <div>
        <SectionHeading eyebrow="Audit" title="Access events" />
        <EventsTable state={events} userLabel={userLabel} />
      </div>
    </div>
  );
}

function GrantsTable({
  state,
  onRevoke,
  userLabel,
}: {
  state: ListState<Grant>;
  onRevoke: (id: string) => void;
  userLabel: (id: string) => string;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      {state.kind === "loading" ? (
        <div className="p-6">
          <div className="skeleton h-20" />
        </div>
      ) : state.kind === "error" ? (
        <div className="p-6 text-red-base">Grants could not be loaded.</div>
      ) : state.kind === "empty" ? (
        <div className="p-8 text-center text-slate-light">
          No break-glass grants have been issued for this tenant.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>User</th>
                <th>Reason</th>
                <th>Granted</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((g) => {
                const s = grantStatus(g);
                return (
                  <tr key={g.id}>
                    <td className="font-medium text-navy">{userLabel(g.userId)}</td>
                    <td className="max-w-[280px] text-slate-base">{g.reason}</td>
                    <td>{formatDateTime(g.grantedAt)}</td>
                    <td>{formatDateTime(g.expiresAt)}</td>
                    <td>
                      <span className={`pill ${s.cls}`}>{s.label}</span>
                    </td>
                    <td>
                      {s.active && (
                        <button
                          onClick={() => onRevoke(g.id)}
                          className="btn-ghost h-6 px-2 text-meta"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EventsTable({ state, userLabel }: { state: ListState<AccessEvent>; userLabel: (id: string) => string }) {
  return (
    <div className="card p-0 overflow-hidden">
      {state.kind === "loading" ? (
        <div className="p-6">
          <div className="skeleton h-20" />
        </div>
      ) : state.kind === "error" ? (
        <div className="p-6 text-red-base">Access events could not be loaded.</div>
      ) : state.kind === "empty" ? (
        <div className="p-8 text-center text-slate-light">
          No access has been recorded against this tenant yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((ev) => (
                <tr key={ev.id}>
                  <td>{formatDateTime(ev.createdAt)}</td>
                  <td className="text-navy">{userLabel(ev.userId)}</td>
                  <td>
                    <span className="tag tag-signal">{ev.action}</span>
                  </td>
                  <td className="font-mono text-xs text-slate-base">
                    {ev.detail ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
