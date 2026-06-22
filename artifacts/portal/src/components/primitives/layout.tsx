import React from "react";

// Shared page chrome. The eyebrow is gold ink, headings are serif, and the page
// width is constrained to the same measure as the rest of the product. Vertical
// breathing room is chosen from a named space scale rather than an inline pad, so
// the rhythm lives in one place.

export function Eyebrow({
  children,
  tone = "gold",
}: {
  children: React.ReactNode;
  tone?: "gold" | "slate" | "navy";
}) {
  const ink = tone === "slate" ? "text-slate-light" : tone === "navy" ? "text-navy" : "text-gold-ink";
  return <div className={`eyebrow ${ink}`}>{children}</div>;
}

const PAGE_SPACE: Record<"page" | "wide" | "tall" | "flush", string> = {
  page: "pt-7 pb-12",
  wide: "pt-7 pb-16",
  tall: "pt-7 pb-24",
  flush: "",
};

export function PageWidth({
  children,
  space = "page",
  style,
}: {
  children: React.ReactNode;
  space?: "page" | "wide" | "tall" | "flush";
  // Deprecated: retained only so call sites compile while they migrate to the
  // named space scale. No new call site should set it.
  style?: React.CSSProperties;
}) {
  return (
    <div className={`page-width ${PAGE_SPACE[space]}`} style={style}>
      {children}
    </div>
  );
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
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-serif text-display font-bold text-navy leading-[1.15] mt-1.5 mb-0">
          {title}
        </h1>
        {subtitle && (
          <div className="text-body text-slate-base mt-2 max-w-[720px] leading-normal">
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex gap-2 items-center">{actions}</div>}
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
    <div className="flex items-baseline justify-between gap-3 mb-3.5">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className={`font-serif text-title font-bold text-navy mb-0 ${eyebrow ? "mt-1" : "mt-0"}`}>
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
