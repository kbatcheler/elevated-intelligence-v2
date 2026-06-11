import React, { useEffect, useState } from "react";
import { AdminUser } from "../../types";
import { TriangleAlert } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";

export function UsersPanel() {
  const { logout, user: currentUser } = useAuth();
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [actionError, setActionError] = useState("");

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 401) return logout();
      if (!res.ok) throw new Error("status " + res.status);
      const data = await res.json();
      setUsers(data.users);
      setState(data.users.length > 0 ? "ready" : "empty");
    } catch (err) {
      setState("error");
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAction = async (id: string, action: "enable" | "disable") => {
    setActionError("");
    try {
      const res = await fetch(`/api/admin/users/${id}/${action}`, { method: "POST" });
      if (res.status === 401) return logout();
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "failed");
      }
      fetchUsers();
    } catch (err: any) {
      if (err.message === "cannot_disable_self") setActionError("You cannot disable your own account.");
      else if (err.message === "cannot_disable_last_owner") setActionError("Cannot disable the last provider owner.");
      else setActionError("Action failed.");
    }
  };

  return (
    <div>
      <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 16 }}>
        System Users
      </h3>
      {actionError && (
        <div className="alert-error" style={{ marginBottom: 16 }}>
          <TriangleAlert size={16} />
          <span>{actionError}</span>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {state === "loading" ? (
          <div style={{ padding: 24 }}><div className="skeleton" style={{ height: 100 }} /></div>
        ) : state === "error" ? (
          <div style={{ padding: 24, color: "var(--red)" }}>Failed to load users.</div>
        ) : state === "empty" ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--slate-light)" }}>No users found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Org</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 500, color: "var(--navy)" }}>{u.displayName} {u.id === currentUser?.id ? "(You)" : ""}</div>
                      <div style={{ fontSize: 12, color: "var(--slate-light)" }}>{u.email}</div>
                    </td>
                    <td><span className="pill pill-navy">{u.role}</span></td>
                    <td>
                      {u.status === "active" ? (
                        <span className="pill pill-verified">Active</span>
                      ) : (
                        <span className="pill pill-gray">Disabled</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 13, color: "var(--navy)" }}>{u.orgName || "-"}</div>
                    </td>
                    <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}</td>
                    <td>
                      {u.status === "active" ? (
                        <button onClick={() => handleAction(u.id, "disable")} className="btn-ghost" style={{ height: 24, padding: "0 8px", fontSize: 11, borderColor: "var(--coral)", color: "var(--coral)" }}>
                          Disable
                        </button>
                      ) : (
                        <button onClick={() => handleAction(u.id, "enable")} className="btn-primary" style={{ height: 24, padding: "0 8px", fontSize: 11 }}>
                          Enable
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
