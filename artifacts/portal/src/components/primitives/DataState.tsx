import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

// The four data states made concrete. The product never shows placeholder or
// fabricated values to fill a gap: loading shows a shimmer, empty states a plain
// fact with the action to fix it, and errors fail loudly in coral.

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
  // Geometry only: a placeholder's height and width are layout dimensions chosen
  // by the caller, not a design token, so they are bound inline. Colour, the
  // shimmer, and the default radius all live on the .skeleton class.
  return <div className="skeleton" style={{ height, width, borderRadius: radius, ...style }} />;
}

// A stack of skeleton lines, the default loading shape for text-heavy panels.
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="grid gap-2.5">
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
    <div className="surface surface-cream surface-dashed text-center px-6 py-8">
      <div className="font-serif text-[18px] text-navy mb-1.5">{title}</div>
      {message && (
        <div className="text-[14px] text-slate-base max-w-[460px] mx-auto mb-4 leading-normal">
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
    <div className="card card-accent-coral p-5">
      <div className="flex gap-3 items-start">
        <AlertTriangle size={18} color="var(--coral)" className="shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-coral-ink mb-1">{title}</div>
          {message && <div className="text-caption text-slate-base">{message}</div>}
          {onRetry && (
            <button className="btn-ghost mt-3" onClick={onRetry}>
              <RotateCw size={14} /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
