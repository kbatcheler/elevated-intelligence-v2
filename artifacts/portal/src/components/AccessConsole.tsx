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
    <div className="max-w-[1080px] mx-auto pt-12 px-8 pb-24">
      <div className="mb-8 flex gap-4 border-b border-border-base">
        {(["pins", "users", "orgs", "ingestion", "layers"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 px-4 bg-transparent border-none border-b-2 cursor-pointer capitalize text-[14px] font-sans ${
              tab === t
                ? "border-navy text-navy font-semibold"
                : "border-transparent text-slate-light font-medium"
            }`}
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
