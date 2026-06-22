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
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 flex-wrap">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-2">
            {c.to && !last ? (
              <Link to={c.to} className="eyebrow text-slate-light no-underline">
                {c.label}
              </Link>
            ) : (
              <span className={`eyebrow ${last ? "text-navy" : "text-slate-light"}`}>{c.label}</span>
            )}
            {!last && <span className="text-cream-dark">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
