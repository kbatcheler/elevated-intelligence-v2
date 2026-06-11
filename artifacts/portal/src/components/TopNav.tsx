import React from "react";
import { ShieldCheck, LogOut, ChevronDown } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useTenant } from "../lib/TenantContext";
import { Link, useRouter } from "../lib/router";
import type { Perspective } from "../types";

interface NavItem {
  to: string;
  label: string;
}

const PRIMARY: NavItem[] = [
  { to: "/", label: "Brief" },
  { to: "/board", label: "Board pack" },
  { to: "/layers", label: "Layers" },
  { to: "/anomalies", label: "Anomalies" },
  { to: "/war-room", label: "War room" },
  { to: "/ask", label: "Ask" },
  { to: "/map", label: "Map" },
  { to: "/heartbeat", label: "Heartbeat" },
  { to: "/reasoning", label: "Architecture" },
  { to: "/actions", label: "Actions" },
  { to: "/connections", label: "Connections" },
];

const PERSPECTIVES: { value: Perspective; label: string }[] = [
  { value: "operator", label: "Operator" },
  { value: "investor", label: "Investor" },
  { value: "board", label: "Board" },
];

function isActive(path: string, to: string): boolean {
  if (to === "/") return path === "/";
  return path === to || path.startsWith(to + "/");
}

export function TopNav() {
  const { user, logout } = useAuth();
  const { tenants, currentId, setCurrentId, perspective, setPerspective } = useTenant();
  const { path } = useRouter();

  const items = [...PRIMARY];
  if (user?.role === "provider-owner") items.push({ to: "/admin", label: "Admin" });

  return (
    <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--border)" }}>
      {/* Top row: identity, tenant switcher, perspective, user */}
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                background: "var(--navy-deep)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <ShieldCheck size={15} color="var(--gold-light)" />
            </div>
            <span className="font-serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)", lineHeight: 1 }}>
              Different Day
            </span>
          </Link>
          <TenantSwitcher tenants={tenants} currentId={currentId} onChange={setCurrentId} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <PerspectiveLens value={perspective} onChange={setPerspective} />
          <div style={{ textAlign: "right", display: "none" }} className="nav-user" />
          {user && (
            <div className={`pill ${user.role.startsWith("provider") ? "pill-navy" : "pill-amber"}`}>{user.role}</div>
          )}
          <button onClick={logout} className="btn-ghost" style={{ padding: "0 8px" }} title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Bottom row: primary navigation */}
      <nav
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          gap: 4,
          overflowX: "auto",
        }}
      >
        {items.map((it) => {
          const active = isActive(path, it.to);
          return (
            <Link
              key={it.to}
              to={it.to}
              className="eyebrow"
              style={{
                padding: "10px 12px",
                textDecoration: "none",
                whiteSpace: "nowrap",
                color: active ? "var(--navy)" : "var(--slate-light)",
                borderBottom: active ? "2px solid var(--gold)" : "2px solid transparent",
                fontWeight: active ? 700 : 600,
              }}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function TenantSwitcher({
  tenants,
  currentId,
  onChange,
}: {
  tenants: { id: string; name: string }[];
  currentId: string | null;
  onChange: (id: string) => void;
}) {
  if (tenants.length === 0) return null;
  if (tenants.length === 1) {
    return (
      <span className="font-serif" style={{ fontSize: 15, color: "var(--navy)" }}>
        {tenants[0].name}
      </span>
    );
  }
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <select
        aria-label="Switch tenant"
        value={currentId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          background: "var(--cream)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "6px 30px 6px 12px",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--navy)",
          cursor: "pointer",
          fontFamily: "var(--font-serif)",
        }}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} color="var(--slate-light)" style={{ position: "absolute", right: 10, pointerEvents: "none" }} />
    </div>
  );
}

function PerspectiveLens({ value, onChange }: { value: Perspective; onChange: (p: Perspective) => void }) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--cream)", padding: 3, borderRadius: 6 }} role="group" aria-label="Perspective lens">
      {PERSPECTIVES.map((p) => {
        const active = p.value === value;
        return (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            aria-pressed={active}
            style={{
              padding: "5px 10px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid " + (active ? "var(--border)" : "transparent"),
              background: active ? "var(--paper)" : "transparent",
              color: active ? "var(--navy)" : "var(--slate)",
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
