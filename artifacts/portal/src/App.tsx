import React from "react";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { Gate } from "./components/Gate";
import { Shell } from "./components/Shell";

function Main() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 300, display: "grid", gap: 16 }}>
          <div className="skeleton" style={{ height: 48, borderRadius: 24, width: 48, margin: "0 auto" }} />
          <div className="skeleton" style={{ height: 24, width: 200, margin: "0 auto" }} />
          <div className="skeleton" style={{ height: 16, width: 150, margin: "0 auto" }} />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Gate />;
  }

  return <Shell />;
}

export default function App() {
  return (
    <AuthProvider>
      <Main />
    </AuthProvider>
  );
}
