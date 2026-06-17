import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, LogOut, ChevronDown, Bell } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useTenant } from "../lib/TenantContext";
import { Link, useRouter } from "../lib/router";
import { fetchNotifications, onUnreadInvalidated } from "../lib/pushApi";
import type { Perspective } from "../types";

interface NavItem {
  to: string;
  label: string;
}

// Diagnosis, reasoning and provenance surfaces every authenticated seat may
// reach (each is tenant-fenced server-side). Connections and Break-glass are the
// provider-side operator tools, appended below only for provider roles, so a
// client seat never sees connector internals or the raw signal read.
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
  { to: "/decisions", label: "Decisions" },
  { to: "/as-of", label: "Replay" },
  { to: "/diligence", label: "Diligence" },
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
  const isProvider = user?.role.startsWith("provider") ?? false;
  // A portfolio seat (and any provider seat) gets the Portfolio board; a client
  // seat never sees the link. The server still fences the data, so this is a
  // navigation affordance, not the access control itself.
  if (isProvider || user?.orgType === "portfolio") {
    items.push({ to: "/portfolio", label: "Portfolio" });
  }
  if (isProvider) {
    items.push({ to: "/connections", label: "Connections" });
    items.push({ to: "/break-glass", label: "Break-glass" });
  }
  if (user?.role === "client-admin") {
    items.push({ to: "/onboarding", label: "Onboarding" });
  }
  if (user?.role === "provider-owner") {
    items.push({ to: "/security", label: "Security" });
    items.push({ to: "/spend", label: "Spend" });
    items.push({ to: "/calibration", label: "Calibration" });
    items.push({ to: "/admin", label: "Admin" });
  }

  return (
    <header style={{ background: "var(--paper)", borderBottom: "1px solid var(--border)" }}>
      {/* Top row: identity, tenant switcher, perspective, user */}
      <div className="top-nav-row">
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

        <div className="nav-actions" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <PerspectiveLens value={perspective} onChange={setPerspective} />
          <div style={{ textAlign: "right", display: "none" }} className="nav-user" />
          <NavBell active={isActive(path, "/notifications")} />
          {user && (
            <div className={`pill ${user.role.startsWith("provider") ? "pill-navy" : "pill-amber"}`}>{user.role}</div>
          )}
          <button onClick={logout} className="btn-ghost" style={{ padding: "0 8px" }} title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Bottom row: primary navigation */}
      <nav className="top-nav-bar">
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
    <div className="nav-switcher" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <select
        className="nav-select"
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

// The notification bell. It links to the center and carries an honest unread
// badge read from the server (pending, sent or failed events not yet opened;
// suppressed events never count). The count refreshes on every navigation so
// returning to any page picks up a freshly read or freshly fired state.
function NavBell({ active }: { active: boolean }) {
  const { path } = useRouter();
  const [unread, setUnread] = useState<number | null>(null);

  // A single loader shared by both triggers: a route change (returning to any
  // page re-reads the count) and an unread-invalidation event (a mark-read or
  // read-all on the center, which carries no route change). A mounted guard
  // keeps a late response from setting state on an unmounted bell.
  const load = useCallback(async (alive: () => boolean) => {
    const out = await fetchNotifications();
    if (!alive()) return;
    if ("state" in out && out.state === "ready") setUnread(out.data.unreadCount);
  }, []);

  useEffect(() => {
    let live = true;
    const alive = () => live;
    void load(alive);
    const unsubscribe = onUnreadInvalidated(() => void load(alive));
    return () => {
      live = false;
      unsubscribe();
    };
  }, [path, load]);

  const badge = unread != null && unread > 0;
  return (
    <Link
      to="/notifications"
      title="Notifications"
      style={{ position: "relative", display: "inline-flex", alignItems: "center", padding: "0 4px" }}
    >
      <Bell size={18} color={active ? "var(--navy)" : "var(--slate)"} />
      {badge && (
        <span
          className="font-mono"
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 8,
            background: "var(--coral)",
            color: "var(--paper)",
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {unread != null && unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
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
