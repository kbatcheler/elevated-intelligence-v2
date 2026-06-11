import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

// The four data states made concrete. The product never shows placeholder or
// fabricated values to fill a gap: loading shows a shimmer, empty states a
// plain fact with the action to fix it, and errors fail loudly in coral.

export function Skeleton({
  height = 16,
  width = "100%",
  radius = 4,
  style,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius, ...style }} />;
}

// A stack of skeleton lines, the default loading shape for text-heavy panels.
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--cream-dark)",
        borderRadius: 4,
        padding: "32px 24px",
        textAlign: "center",
        background: "var(--cream-light)",
      }}
    >
      <div className="font-serif" style={{ fontSize: 18, color: "var(--navy)", marginBottom: 6 }}>
        {title}
      </div>
      {message && (
        <div style={{ fontSize: 14, color: "var(--slate)", maxWidth: 460, margin: "0 auto 16px" }}>
          {message}
        </div>
      )}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something failed to load",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card card-accent-coral" style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <AlertTriangle size={18} color="var(--coral)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: "var(--coral)", marginBottom: 4 }}>{title}</div>
          {message && <div style={{ fontSize: 13, color: "var(--slate)" }}>{message}</div>}
          {onRetry && (
            <button className="btn-ghost" style={{ marginTop: 12 }} onClick={onRetry}>
              <RotateCw size={14} /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
