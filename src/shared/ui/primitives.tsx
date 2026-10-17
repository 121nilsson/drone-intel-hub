import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  id,
  title,
  right,
  children,
  className,
  contentClassName,
}: {
  id?: string;
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "min-w-0 scroll-mt-20 border border-border bg-card/80 backdrop-blur",
        className,
      )}
    >
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2">
          <h2 className="min-w-0 break-words font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className={cn("min-w-0 p-4", contentClassName)}>{children}</div>
    </section>
  );
}

export function Tag({
  children,
  tone = "default",
  className,
  title,
  caps = true,
  mono = true,
}: {
  children: ReactNode;
  tone?: "default" | "primary" | "accent" | "danger" | "success" | "warning" | "info" | "muted";
  className?: string;
  title?: string;
  caps?: boolean;
  mono?: boolean;
}) {
  const tones = {
    default: "border-border text-muted-foreground",
    primary: "border-primary/50 text-primary",
    accent: "border-accent/50 text-accent",
    danger: "border-destructive/50 text-destructive",
    success: "border-success/50 text-success",
    warning: "border-warning/50 text-warning",
    info: "border-chart-3/50 text-chart-3",
    muted: "border-border/60 text-muted-foreground/80",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 text-[11px]",
        mono ? "font-mono" : "font-sans",
        caps && "uppercase",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ConfidenceTag({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <Tag tone={level === "high" ? "primary" : level === "medium" ? "accent" : "danger"}>
      {level}
    </Tag>
  );
}

/**
 * One page-title treatment for the whole app: mono is reserved for chrome and numbers, so
 * page titles use the body font with consistent size and spacing.
 */
export function PageTitle({
  children,
  subtitle,
  className,
}: {
  children: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-1", className)}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{children}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </header>
  );
}

/** Numeric values: tabular, mono, so columns line up and change without layout shift. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{children}</span>;
}

/** Tiny inline line chart for a short series (e.g. 7-day report counts). */
export function Sparkline({
  values,
  width = 48,
  height = 14,
  className,
  stroke = "currentColor",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
}) {
  const series = values.length ? values : [0];
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const range = max - min || 1;
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const points = series
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 2) - 1).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("inline-block align-middle text-primary", className)}
      role="img"
      aria-label="sparkline"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

/** Shared loading affordance: repositories are async after SSR (see Services.attached). */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="animate-pulse font-mono text-sm text-muted-foreground">{label}</p>;
}

export function Btn({
  className,
  variant = "primary",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/85",
    ghost: "border border-border text-foreground hover:bg-secondary",
    danger: "border border-destructive/60 text-destructive hover:bg-destructive/10",
  };
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors disabled:opacity-50",
        v[variant],
        className,
      )}
    />
  );
}

/** Shared card surface: never wider than its column, long content wraps or truncates. */
export function Card({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-col overflow-hidden border border-border bg-card/80 [overflow-wrap:anywhere]",
        interactive && "transition-colors hover:border-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Responsive card grid: one column on phones, `cols` from md up. Columns can always shrink. */
export function CardGrid({
  children,
  cols = 2,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3",
        cols === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Shared list row: title + optional subtitle on top, meta and actions below on phones;
 * one line on wider screens. Pages pass content, never their own row layout.
 */
export function ListRow({
  title,
  subtitle,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <div className="min-w-0">{title}</div>
        {subtitle && <div className="min-w-0 text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {(meta || actions) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {meta}
          {actions}
        </div>
      )}
    </li>
  );
}
