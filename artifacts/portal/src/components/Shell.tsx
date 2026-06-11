import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { ShieldCheck, LogOut } from "lucide-react";
import { Dashboard } from "./Dashboard";
import { AccessConsole } from "./AccessConsole";

export function Shell() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<"dashboard" | "console">("dashboard");

  if (!user) return null;

  return (
    <div className="scroll-area" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--border)", padding: "16px 32px" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 16, background: "var(--navy-deep)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ShieldCheck size={16} color="var(--gold-light)" />
              </div>
              <div className="font-serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--navy)", lineHeight: 1 }}>
                Different Day
              </div>
            </div>

            {user.role === "provider-owner" && (
              <div style={{ display: "flex", gap: 8, background: "var(--cream)", padding: 4, borderRadius: 6 }}>
                <button
                  onClick={() => setView("dashboard")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 600,
                    background: view === "dashboard" ? "var(--paper)" : "transparent",
                    color: view === "dashboard" ? "var(--navy)" : "var(--slate)",
                    border: view === "dashboard" ? "1px solid var(--border)" : "1px solid transparent",
                    cursor: "pointer",
                    boxShadow: view === "dashboard" ? "0 1px 2px rgba(0,0,0,0.02)" : "none"
                  }}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setView("console")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 600,
                    background: view === "console" ? "var(--paper)" : "transparent",
                    color: view === "console" ? "var(--navy)" : "var(--slate)",
                    border: view === "console" ? "1px solid var(--border)" : "1px solid transparent",
                    cursor: "pointer",
                    boxShadow: view === "console" ? "0 1px 2px rgba(0,0,0,0.02)" : "none"
                  }}
                >
                  Access Console
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>{user.displayName}</div>
              <div style={{ fontSize: 11, color: "var(--slate-light)" }}>{user.email}</div>
            </div>
            <div className={`pill ${user.role.startsWith('provider') ? 'pill-navy' : 'pill-amber'}`}>
              {user.role}
            </div>
            <button onClick={logout} className="btn-ghost" style={{ padding: "0 8px" }} title="Log out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: "auto" }} className="scroll-area">
        {view === "dashboard" ? <Dashboard /> : <AccessConsole />}
      </div>
    </div>
  );
}
