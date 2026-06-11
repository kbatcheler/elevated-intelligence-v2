import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Perspective, TenantSummary } from "../types";
import { fetchTenants } from "./tenantApi";
import { useAuth } from "./AuthContext";

// The tenant the portal is currently looking at, the set the caller may switch
// between (already access-filtered server-side), and the perspective lens. Both
// the current tenant and the lens persist across reloads so the product opens
// where the user left it. A 401 anywhere ends the session cleanly.

const STORAGE_TENANT = "ei.tenantId";
const STORAGE_PERSPECTIVE = "ei.perspective";

type Status = "loading" | "ready" | "empty" | "error";

interface TenantContextValue {
  tenants: TenantSummary[];
  current: TenantSummary | null;
  currentId: string | null;
  setCurrentId: (id: string) => void;
  status: Status;
  perspective: Perspective;
  setPerspective: (p: Perspective) => void;
  reload: () => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

function readPerspective(): Perspective {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_PERSPECTIVE) : null;
  return v === "investor" || v === "board" ? v : "operator";
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [currentId, setCurrentIdState] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_TENANT) : null,
  );
  const [status, setStatus] = useState<Status>("loading");
  const [perspective, setPerspectiveState] = useState<Perspective>(readPerspective);

  const load = useCallback(async () => {
    setStatus("loading");
    const out = await fetchTenants();
    if ("unauthorized" in out) {
      await logout();
      return;
    }
    if (out.state === "error") {
      setStatus("error");
      return;
    }
    setTenants(out.items);
    setStatus(out.items.length > 0 ? "ready" : "empty");
    setCurrentIdState((prev) => {
      if (prev && out.items.some((t) => t.id === prev)) return prev;
      return out.items[0]?.id ?? null;
    });
  }, [logout]);

  useEffect(() => {
    load();
  }, [load]);

  const setCurrentId = useCallback((id: string) => {
    setCurrentIdState(id);
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_TENANT, id);
  }, []);

  const setPerspective = useCallback((p: Perspective) => {
    setPerspectiveState(p);
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_PERSPECTIVE, p);
  }, []);

  const current = tenants.find((t) => t.id === currentId) ?? null;

  return (
    <TenantContext.Provider
      value={{ tenants, current, currentId, setCurrentId, status, perspective, setPerspective, reload: load }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}
