import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

// A hand-rolled history router. The product ships no routing dependency: this
// owns path state, browser history, base-path tolerance and link interception
// in roughly a hundred lines. The pure path helpers below are unit-tested; the
// React surface around them stays thin.

const RAW_BASE = (import.meta.env.BASE_URL as string | undefined) ?? "/";

// Normalize a configured base ("/", "/portal/") to a prefix with no trailing
// slash ("" for root, "/portal" otherwise) so it concatenates cleanly.
export function normalizeBase(base: string): string {
  if (!base || base === "/") return "";
  return base.replace(/\/+$/, "");
}

export const BASE = normalizeBase(RAW_BASE);

// Turn a full browser pathname into the app path, always starting with "/".
export function stripBase(pathname: string, base = BASE): string {
  if (base && (pathname === base || pathname.startsWith(base + "/"))) {
    const rest = pathname.slice(base.length);
    return rest.length === 0 ? "/" : rest;
  }
  return pathname.length === 0 ? "/" : pathname;
}

// Prepend the base to an app path for hrefs and history entries.
export function withBase(path: string, base = BASE): string {
  const p = path.startsWith("/") ? path : "/" + path;
  return base + p;
}

// Match a pattern such as "/layers/:key" against an app path. Returns the
// captured params, or null when the shapes differ. Order-sensitive, exact
// segment count; this is all the routing the product needs.
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = path.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i];
    if (seg.startsWith(":")) {
      params[seg.slice(1)] = decodeURIComponent(ap[i]);
    } else if (seg !== ap[i]) {
      return null;
    }
  }
  return params;
}

interface RouterValue {
  path: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | undefined>(undefined);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => stripBase(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPath(stripBase(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = withBase(to);
    if (opts?.replace) {
      window.history.replaceState({}, "", url);
    } else {
      window.history.pushState({}, "", url);
    }
    setPath(stripBase(window.location.pathname));
    const scroller = document.querySelector(".app-scroll");
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  }, []);

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within a RouterProvider");
  return ctx;
}

type LinkProps = {
  to: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
};

// An anchor that navigates through the router on a plain left-click but lets the
// browser handle modified clicks (new tab, etc.) and renders a real href so the
// link is shareable and accessible.
export function Link({ to, children, className, style, title, onClick }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    navigate(to);
    onClick?.(e);
  };
  return (
    <a href={withBase(to)} onClick={handle} className={className} style={style} title={title}>
      {children}
    </a>
  );
}
