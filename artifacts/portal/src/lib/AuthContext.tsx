import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User } from "../types";
import * as authApi from "./authApi";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (email: string, displayName: string, password: string, pin: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setUser(await authApi.fetchStatus());
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    if (result.user) setUser(result.user);
    return result.error ? { error: result.error } : {};
  };

  const register = async (email: string, displayName: string, password: string, pin: string) => {
    const result = await authApi.register(email, displayName, password, pin);
    if (result.user) setUser(result.user);
    return result.error ? { error: result.error } : {};
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
