import React, { useState } from "react";
import { Login } from "./Login";
import { Register } from "./Register";
import { ShieldCheck } from "lucide-react";

export function Gate() {
  const [view, setView] = useState<"login" | "register">("login");

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6">
      <div className="mb-10 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-[24px] bg-navy-deep flex items-center justify-center">
            <ShieldCheck size={24} color="var(--gold-light)" />
          </div>
        </div>
        <div className="font-serif text-display font-bold text-navy">Different Day</div>
        <div className="eyebrow text-gold-ink mt-2">Elevated Intelligence</div>
      </div>
      
      {view === "login" ? (
        <Login onSwitch={() => setView("register")} />
      ) : (
        <Register onSwitch={() => setView("login")} />
      )}
    </div>
  );
}
