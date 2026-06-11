import React, { useEffect, useState } from "react";
import { AdminUser } from "../../types";
import { TriangleAlert } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import * as adminApi from "../../lib/adminApi";

export function UsersPanel() {
  const { logout, user: currentUser } = useAuth();
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [actionError, setActionError] = useState("");

  const fetchUsers = async () => {
    const result = await adminApi.fetchUsers();
    if ("unauthorized" in result) return logout();
    if (result.state === "error") {
      setState("error");
      return;
    }
    setUsers(result.items);
    setState(result.state);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAction = async (id: string, action: "enable" | "disable") => {
    setActionError("");
    const result = await adminApi.setUserStatus(id, action);
    if ("unauthorized" in result) return logout();
    if ("error" in result) {
      if (result.error === "cannot_disable_self") setActionError("You cannot disable your own account.");
      else if (result.error === "cannot_disable_last_owner") setActionError("Cannot disable the last provider owner.");
      else setActionError("Action failed.");
      return;
    }
    fetchUsers();
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
