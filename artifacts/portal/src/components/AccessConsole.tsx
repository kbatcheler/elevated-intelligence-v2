import React, { useEffect, useState } from "react";
import { PinsPanel } from "./admin/PinsPanel";
import { UsersPanel } from "./admin/UsersPanel";
import { OrgsPanel } from "./admin/OrgsPanel";
import { IngestionPanel } from "./admin/IngestionPanel";
import { CustomLayerPanel } from "./admin/CustomLayerPanel";
import { Org, Tenant } from "../types";
import { useAuth } from "../lib/AuthContext";
import * as adminApi from "../lib/adminApi";

export function AccessConsole() {
  const { logout } = useAuth();
  const [tab, setTab] = useState<"pins" | "users" | "orgs" | "ingestion" | "layers">("pins");
  
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsState, setOrgsState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const fetchOrgs = async () => {
    const result = await adminApi.fetchOrgs();
    if ("unauthorized" in result) return logout();
    if (result.state === "error") {
      setOrgsState("error");
      return;
    }
    setOrgs(result.items);
    setOrgsState(result.state);
  };

  const fetchTenants = async () => {
    const result = await adminApi.fetchTenants();
    if ("unauthorized" in result) return logout();
    if (result.state === "error") return;
    setTenants(result.items);
  };

  useEffect(() => {
    fetchOrgs();
    fetchTenants();
  }, []);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 32px 96px" }}>
      <div style={{ marginBottom: 32, display: "flex", gap: 16, borderBottom: "1px solid var(--border)" }}>
        {(["pins", "users", "orgs", "ingestion", "layers"] as const).map(t => (
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
        {tab === "ingestion" && <IngestionPanel tenants={tenants} />}
        {tab === "layers" && <CustomLayerPanel />}
      </div>
    </div>
  );
}
