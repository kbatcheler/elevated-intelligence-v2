import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { TriangleAlert, Loader2 } from "lucide-react";

export function Register({ onSwitch }: { onSwitch: () => void }) {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    setErrorMsg("");
    setLoading(true);
    const { error } = await register(email, displayName, password, pin);
    setLoading(false);
    if (error) {
      if (error === "invalid_or_used_pin") setErrorMsg("That invite PIN is not valid.");
      else if (error === "email_taken") setErrorMsg("An account with that email already exists.");
      else setErrorMsg("An error occurred. Please check your inputs.");
    }
  };

  return (
    <div className="card card-accent-gold" style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>
      <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 600, color: "var(--navy)", marginBottom: 8 }}>
        Create Account
      </h2>
      <p style={{ fontSize: 14, color: "var(--slate-light)", marginBottom: 24 }}>
        Join the intelligence layer with your invite PIN.
      </p>

      {errorMsg && (
        <div className="alert-error" style={{ marginBottom: 20 }}>
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label className="label-base" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input-base"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label-base" htmlFor="displayName">Display Name</label>
          <input
            id="displayName"
            type="text"
            className="input-base"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label-base" htmlFor="password">Password (min 8 chars)</label>
          <input
            id="password"
            type="password"
            className="input-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div>
          <label className="label-base" htmlFor="pin">Invite PIN</label>
          <input
            id="pin"
            type="text"
            className="input-base"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn-primary" style={{ marginTop: 8, height: 40 }} disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Create Account"}
        </button>
      </form>

      <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "var(--slate-light)" }}>
        Already have an account?{" "}
        <button onClick={onSwitch} style={{ color: "var(--navy)", fontWeight: 600, cursor: "pointer" }}>
          Sign In
        </button>
      </div>
    </div>
  );
}
