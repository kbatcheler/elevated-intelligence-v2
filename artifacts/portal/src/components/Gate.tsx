import React, { useState } from "react";
import { Login } from "./Login";
import { Register } from "./Register";
import { ShieldCheck } from "lucide-react";

export function Gate() {
  const [view, setView] = useState<"login" | "register">("login");

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ marginBottom: 40, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: "var(--navy-deep)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ShieldCheck size={24} color="var(--gold-light)" />
          </div>
        </div>
        <div className="font-serif" style={{ fontSize: 28, fontWeight: 700, color: "var(--navy)" }}>Different Day</div>
        <div className="eyebrow" style={{ color: "var(--gold)", marginTop: 8 }}>Elevated Intelligence</div>
      </div>
      
      {view === "login" ? (
        <Login onSwitch={() => setView("register")} />
      ) : (
        <Register onSwitch={() => setView("login")} />
      )}
    </div>
  );
}
