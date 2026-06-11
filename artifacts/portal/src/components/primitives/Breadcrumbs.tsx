import React from "react";
import { Link } from "../../lib/router";

export interface Crumb {
  label: string;
  to?: string;
}

// A trail of where you are. The final crumb is the current page and is not a
// link. Separated by a slash, never an em-dash.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {c.to && !last ? (
              <Link to={c.to} className="eyebrow" style={{ color: "var(--slate-light)", textDecoration: "none" }}>
                {c.label}
              </Link>
            ) : (
              <span className="eyebrow" style={{ color: last ? "var(--navy)" : "var(--slate-light)" }}>
                {c.label}
              </span>
            )}
            {!last && <span style={{ color: "var(--cream-dark)" }}>/</span>}
          </span>
        );
      })}
    </nav>
  );
}
