import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { TriangleAlert, Loader2 } from "lucide-react";

export function Login({ onSwitch }: { onSwitch: () => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);
    const { error } = await login(email, password);
    setLoading(false);
    if (error) {
      if (error === "invalid_credentials") setErrorMsg("Those credentials were not recognised.");
      else if (error === "account_disabled") setErrorMsg("This account has been disabled.");
      else setErrorMsg("An error occurred. Please try again.");
    }
  };

  return (
    <div className="card card-accent-navy max-w-[400px] w-full mx-auto">
      <h2 className="font-serif text-section font-semibold text-navy mb-2">
        Sign In
      </h2>
      <p className="text-[14px] text-slate-light mb-6">
        Access your executive intelligence desk.
      </p>

      {errorMsg && (
        <div className="alert-error mb-5">
          <TriangleAlert size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="label-base" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input-base"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label-base" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="btn-primary mt-2 h-10" disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Sign In"}
        </button>
      </form>

      <div className="mt-6 text-center text-caption text-slate-light">
        Do not have an account?{" "}
        <button onClick={onSwitch} className="text-navy font-semibold cursor-pointer">
          Create Account
        </button>
      </div>
    </div>
  );
}
