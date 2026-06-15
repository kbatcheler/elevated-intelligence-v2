import React from "react";

// Shared page chrome. The eyebrow is gold ink, headings are serif, and the page
// width is constrained to the same measure as the rest of the product.

export function Eyebrow({ children, color = "var(--gold-ink)" }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="eyebrow" style={{ color }}>
      {children}
    </div>
  );
}

export function PageWidth({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="page-width" style={style}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-serif" style={{ fontSize: 28, fontWeight: 700, color: "var(--navy)", margin: "6px 0 0", lineHeight: 1.15 }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 15, color: "var(--slate)", marginTop: 8, maxWidth: 720, lineHeight: 1.5 }}>
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="font-serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--navy)", margin: eyebrow ? "4px 0 0" : 0 }}>
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
