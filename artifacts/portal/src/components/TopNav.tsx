import React, { useCallback, useEffect, useRef, useState } from "react";
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

interface NavGroup {
  heading: string;
  items: NavItem[];
}

// The five surfaces a seat reaches every day stay on the bar; everything else is
// grouped under More so the navigation reads as a short, confident spine rather
// than a wall of links. Each surface is still tenant-fenced server-side, and the
// role-gated entries below are navigation affordances layered on top of that
// fence, never the access control itself: a client seat never sees the operator
// tools, and typing the URL still resolves to the same server decision.
const PRIMARY: NavItem[] = [
  { to: "/", label: "Brief" },
  { to: "/board", label: "Board pack" },
  { to: "/layers", label: "Layers" },
  { to: "/decisions", label: "Decisions" },
  { to: "/outcome-loop", label: "Outcome loop" },
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

  const isProvider = user?.role.startsWith("provider") ?? false;

  // The deeper analysis surfaces, grouped under More. Portfolio is appended only
  // for a portfolio or provider seat; the server still fences the data.
  const analysis: NavItem[] = [
    { to: "/anomalies", label: "Anomalies" },
    { to: "/war-room", label: "War room" },
    { to: "/ask", label: "Ask" },
    { to: "/map", label: "Map" },
    { to: "/heartbeat", label: "Heartbeat" },
    { to: "/reasoning", label: "Architecture" },
    { to: "/actions", label: "Actions" },
    { to: "/as-of", label: "Replay" },
    { to: "/diligence", label: "Diligence" },
  ];
  if (isProvider || user?.orgType === "portfolio") {
    analysis.push({ to: "/portfolio", label: "Portfolio" });
  }

  // The operator and owner tools, gated by role exactly as before, grouped apart
  // from the analysis surfaces so the menu reads as two intents.
  const operations: NavItem[] = [];
  if (isProvider) {
    operations.push({ to: "/connections", label: "Connections" });
    operations.push({ to: "/break-glass", label: "Break-glass" });
  }
  if (user?.role === "client-admin") {
    operations.push({ to: "/onboarding", label: "Onboarding" });
  }
  if (user?.role === "provider-owner") {
    operations.push({ to: "/security", label: "Security" });
    operations.push({ to: "/spend", label: "Spend" });
    operations.push({ to: "/calibration", label: "Calibration" });
    operations.push({ to: "/admin", label: "Admin" });
  }

  const groups: NavGroup[] = [
    { heading: "Analysis", items: analysis },
    { heading: "Operations", items: operations },
  ];

  return (
    <header className="bg-paper border-b border-border-base">
      {/* Top row: identity, tenant switcher, perspective, user */}
      <div className="top-nav-row">
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <div className="w-[30px] h-[30px] rounded-full bg-navy-deep flex items-center justify-center shrink-0">
              <ShieldCheck size={15} color="var(--gold-light)" />
            </div>
            <span className="font-serif text-lead font-bold text-navy leading-none">Different Day</span>
          </Link>
          <TenantSwitcher tenants={tenants} currentId={currentId} onChange={setCurrentId} />
        </div>

        <div className="nav-actions flex items-center gap-3.5">
          <PerspectiveLens value={perspective} onChange={setPerspective} />
          <NavBell active={isActive(path, "/notifications")} />
          {user && (
            <div className={`pill ${user.role.startsWith("provider") ? "pill-navy" : "pill-amber"}`}>{user.role}</div>
          )}
          <button onClick={logout} className="btn-ghost px-2 py-0" title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Bottom row: primary navigation, with the rest grouped under More */}
      <nav className="top-nav-bar">
        {PRIMARY.map((it) => (
          <NavTab key={it.to} item={it} active={isActive(path, it.to)} />
        ))}
        <SecondaryNav groups={groups} path={path} />
      </nav>
    </header>
  );
}

function NavTab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={`eyebrow px-3 py-2.5 whitespace-nowrap no-underline border-b-2 ${
        active ? "text-navy border-gold font-bold" : "text-slate-light border-transparent font-semibold"
      }`}
    >
      {item.label}
    </Link>
  );
}

// The secondary grouping. One menu holds every surface that is not part of the
// daily spine, split into its labelled groups. It closes on a click outside and
// on any route change so it never lingers over the page beneath it.
function SecondaryNav({ groups, path }: { groups: NavGroup[]; path: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = groups.filter((g) => g.items.length > 0);
  const anyActive = visible.some((g) => g.items.some((it) => isActive(path, it.to)));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  if (visible.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`eyebrow px-3 py-2.5 whitespace-nowrap inline-flex items-center gap-1 border-b-2 bg-transparent cursor-pointer ${
          anyActive ? "text-navy border-gold font-bold" : "text-slate-light border-transparent font-semibold"
        }`}
      >
        More <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[208px] bg-paper border border-border-base rounded-lg shadow-lg py-1.5">
          {visible.map((g, gi) => (
            <div key={g.heading} className={gi > 0 ? "mt-1 pt-1.5 border-t border-border-base" : ""}>
              <div className="eyebrow text-slate-light px-3.5 pb-1">{g.heading}</div>
              {g.items.map((it) => {
                const active = isActive(path, it.to);
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={`block px-3.5 py-2 text-caption no-underline hover:bg-cream ${
                      active ? "text-navy font-semibold bg-cream" : "text-slate-base"
                    }`}
                  >
                    {it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
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
    return <span className="font-serif text-body text-navy">{tenants[0].name}</span>;
  }
  return (
    <div className="nav-switcher relative inline-flex items-center">
      <select
        className="nav-select appearance-none bg-cream border border-border-base rounded-md pl-3 pr-[30px] py-1.5 text-[14px] font-semibold text-navy cursor-pointer font-serif"
        aria-label="Switch tenant"
        value={currentId ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} color="var(--slate-light)" className="absolute right-2.5 pointer-events-none" />
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
    <Link to="/notifications" title="Notifications" className="relative inline-flex items-center px-1">
      <Bell size={18} color={active ? "var(--navy)" : "var(--slate)"} />
      {badge && (
        <span className="font-mono absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-lg bg-coral text-paper text-[10px] font-bold flex items-center justify-center leading-none">
          {unread != null && unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

function PerspectiveLens({ value, onChange }: { value: Perspective; onChange: (p: Perspective) => void }) {
  return (
    <div className="flex gap-0.5 bg-cream p-[3px] rounded-md" role="group" aria-label="Perspective lens">
      {PERSPECTIVES.map((p) => {
        const active = p.value === value;
        return (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            aria-pressed={active}
            className={`py-[5px] px-2.5 rounded text-xs font-semibold cursor-pointer border ${
              active ? "border-border-base bg-paper text-navy" : "border-transparent bg-transparent text-slate-base"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
