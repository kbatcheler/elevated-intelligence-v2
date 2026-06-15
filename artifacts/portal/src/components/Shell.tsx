import React, { useCallback, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { TenantProvider } from "../lib/TenantContext";
import { matchPath, useRouter, Link } from "../lib/router";
import { TopNav } from "./TopNav";
import { BootSplash } from "./BootSplash";
import { Dashboard } from "./Dashboard";
import { AccessConsole } from "./AccessConsole";
import { BriefPage } from "./pages/BriefPage";
import { BoardPackPage } from "./pages/BoardPackPage";
import { LayersPage } from "./pages/LayersPage";
import { LayerPage } from "./pages/LayerPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ReasoningPage } from "./pages/ReasoningPage";
import { ActionsPage } from "./pages/ActionsPage";
import { AnomaliesPage } from "./pages/AnomaliesPage";
import { WarRoomPage } from "./pages/WarRoomPage";
import { AskDifferentDayPage } from "./pages/AskDifferentDayPage";
import { DependencyMapPage } from "./pages/DependencyMapPage";
import { HeartbeatPage } from "./pages/HeartbeatPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { BreakGlassPage } from "./pages/BreakGlassPage";
import { SpendPage } from "./pages/SpendPage";
import { SecurityConsole } from "./security/SecurityConsole";
import { Onboarding } from "./Onboarding";
import { EmptyState, PageWidth } from "./primitives";
import type { UserRole } from "../types";

const BOOT_FLAG = "ei.booted";

export function Shell() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <TenantProvider>
      <ShellInner role={user.role} />
    </TenantProvider>
  );
}

// The boot splash shows once per browser session, then the app. The gate lives
// inside TenantProvider so the splash can read the current tenant's real runs.
function ShellInner({ role }: { role: UserRole }) {
  const [booted, setBooted] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(BOOT_FLAG) === "1",
  );
  const finishBoot = useCallback(() => {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(BOOT_FLAG, "1");
    setBooted(true);
  }, []);

  if (!booted) return <BootSplash onDone={finishBoot} />;

  return (
    <div className="scroll-area" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <TopNav />
      <div className="scroll-area app-scroll" style={{ flex: 1, overflowY: "auto" }}>
        <Routes role={role} />
      </div>
    </div>
  );
}

// The route table. The hand-rolled router gives us the current app path; we
// resolve it to a page here. The only parameterized route is the layer detail.
// Provider-only and owner-only surfaces resolve to NotFound for a client seat,
// so a client typing the URL gets the same dead end as a hidden nav link.
function Routes({ role }: { role: UserRole }) {
  const { path } = useRouter();
  const isProvider = role === "provider-owner" || role === "provider-member";
  const isOwner = role === "provider-owner";

  const layerMatch = matchPath("/layers/:key", path);
  if (layerMatch) return <LayerPage layerKey={layerMatch.key} />;

  switch (path) {
    case "/":
      return <BriefPage />;
    case "/board":
      return <BoardPackPage />;
    case "/layers":
      return <LayersPage />;
    case "/portfolio":
      // No role gate here: the server resolves portfolio scope from the session
      // and returns 403 portfolio_only for any non-portfolio, non-provider seat,
      // which the page renders as an honest access state. A client seat that
      // types the URL simply sees that panel rather than a hidden NotFound.
      return <PortfolioPage />;
    case "/notifications":
      // Every authenticated seat has a notification center; the server fences the
      // events and rules to the tenants the seat can reach and returns an empty
      // set otherwise, which the page renders as an honest empty state.
      return <NotificationsPage />;
    case "/anomalies":
      return <AnomaliesPage />;
    case "/war-room":
      return <WarRoomPage />;
    case "/ask":
      return <AskDifferentDayPage />;
    case "/map":
      return <DependencyMapPage />;
    case "/heartbeat":
      return <HeartbeatPage />;
    case "/reasoning":
      return <ReasoningPage />;
    case "/actions":
      return <ActionsPage />;
    case "/connections":
      return isProvider ? <ConnectionsPage /> : <NotFound />;
    case "/break-glass":
      return isProvider ? <BreakGlassPage /> : <NotFound />;
    case "/onboarding":
      return role === "client-admin" ? <Onboarding /> : <NotFound />;
    case "/design-language":
      return <Dashboard />;
    case "/security":
      return isOwner ? <SecurityConsole /> : <NotFound />;
    case "/spend":
      return isOwner ? <SpendPage /> : <NotFound />;
    case "/admin":
      return isOwner ? <AccessConsole /> : <NotFound />;
    default:
      return <NotFound />;
  }
}

function NotFound() {
  return (
    <PageWidth style={{ paddingTop: 48, paddingBottom: 48 }}>
      <EmptyState
        title="Page not found"
        message="This surface does not exist."
        action={
          <Link to="/" className="btn-primary" style={{ textDecoration: "none" }}>
            Back to the brief
          </Link>
        }
      />
    </PageWidth>
  );
}
