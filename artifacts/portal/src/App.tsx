import React from "react";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { RouterProvider, matchPath, useRouter } from "./lib/router";
import { Gate } from "./components/Gate";
import { Shell } from "./components/Shell";
import { PublicDiagnosisPage } from "./components/pages/PublicDiagnosisPage";

function Main() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-[300px] grid gap-4">
          <div className="skeleton h-12 w-12 rounded-[24px] mx-auto" />
          <div className="skeleton h-6 w-[200px] mx-auto" />
          <div className="skeleton h-4 w-[150px] mx-auto" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Gate />;
  }

  return <Shell />;
}

// The shareable diagnosis renders OUTSIDE the auth provider: a cold prospect has
// no session and must never trigger an auth probe or see the sign-in gate. Every
// other path runs through the authenticated app shell.
function Root() {
  const { path } = useRouter();
  const publicMatch = matchPath("/d/:token", path);
  if (publicMatch) {
    return <PublicDiagnosisPage token={publicMatch.token} />;
  }
  return (
    <AuthProvider>
      <Main />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <Root />
    </RouterProvider>
  );
}
