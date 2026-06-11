import React, { useEffect, useState } from "react";
import { PinsPanel } from "./admin/PinsPanel";
import { UsersPanel } from "./admin/UsersPanel";
import { OrgsPanel } from "./admin/OrgsPanel";
import { Org } from "../types";
import { useAuth } from "../lib/AuthContext";

export function AccessConsole() {
  const { logout } = useAuth();
  const [tab, setTab] = useState<"pins" | "users" | "orgs">("pins");
  
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsState, setOrgsState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  const fetchOrgs = async () => {
    try {
      const res = await fetch("/api/admin/orgs");
      if (res.status === 401) return logout();
      if (!res.ok) throw new Error("status " + res.status);
      const data = await res.json();
      setOrgs(data.orgs);
      setOrgsState(data.orgs.length > 0 ? "ready" : "empty");
    } catch (err) {
      setOrgsState("error");
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 32px 96px" }}>
      <div style={{ marginBottom: 32, display: "flex", gap: 16, borderBottom: "1px solid var(--border)" }}>
        {(["pins", "users", "orgs"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "12px 16px",
              background: "transparent",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--navy)" : "2px solid transparent",
              color: tab === t ? "var(--navy)" : "var(--slate-light)",
              fontWeight: tab === t ? 600 : 500,
              cursor: "pointer",
              textTransform: "capitalize",
              fontSize: 14,
              fontFamily: "Inter, sans-serif"
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        {tab === "pins" && <PinsPanel orgs={orgs} />}
        {tab === "users" && <UsersPanel />}
        {tab === "orgs" && <OrgsPanel orgs={orgs} refreshOrgs={fetchOrgs} />}
      </div>
    </div>
  );
}
