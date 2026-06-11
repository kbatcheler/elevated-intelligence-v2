import type { User } from "../types";

// The portal reaches the API only through the single-origin /api proxy. These
// helpers own the one real piece of logic in the portal data layer: mapping each
// HTTP status to the stable error code the UI renders. They are framework free,
// so they can be unit tested with a mocked fetch and no DOM.

export interface AuthOutcome {
  user?: User;
  error?: string;
}

export async function fetchStatus(): Promise<User | null> {
  try {
    const res = await fetch("/api/auth/status");
    if (!res.ok) return null;
    const data = await res.json();
    return data.authenticated ? (data.user as User) : null;
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<AuthOutcome> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      const data = await res.json();
      return { user: data.user as User };
    }
    if (res.status === 401) return { error: "invalid_credentials" };
    if (res.status === 403) return { error: "account_disabled" };
    return { error: "invalid_input" };
  } catch {
    return { error: "network_error" };
  }
}

export async function register(
  email: string,
  displayName: string,
  password: string,
  pin: string,
): Promise<AuthOutcome> {
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName, password, pin }),
    });
    if (res.ok) {
      const data = await res.json();
      return { user: data.user as User };
    }
    if (res.status === 403) return { error: "invalid_or_used_pin" };
    if (res.status === 409) return { error: "email_taken" };
    return { error: "invalid_input" };
  } catch {
    return { error: "network_error" };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Logout is best effort; the caller clears local state regardless.
  }
}
