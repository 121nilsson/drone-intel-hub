import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonClass, type BtnSize, type BtnVariant } from "./button-class";

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
  // Placeholder rows in the shape of a page, so the content arrives in place instead of
  // pushing a one-line message off the screen.
  return (
    <div role="status" className="space-y-4">
      <p className="font-mono text-xs text-muted-foreground">{label}</p>
      <div className="h-7 w-1/3 animate-pulse bg-secondary" />
      <div className="space-y-2">
        {[92, 78, 85, 64, 88, 72].map((w, i) => (
          <div key={i} className="h-10 animate-pulse bg-secondary/70" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

export function Btn({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button {...p} type={type} className={buttonClass({ variant, size, className })} />;
}

/**
 * A one-of-N switch ("Compact | Cards"): buttons share one border and the chosen one is
 * pressed, so the control reads as a single choice rather than a row of actions.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex shrink-0 border border-border" role="group" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2 py-1 font-mono text-2xs transition-colors pointer-coarse:min-h-9",
            i > 0 && "border-l border-border",
            value === o.value
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** What a list shows when it has nothing: one sentence and, usually, the way out. */
export function EmptyState({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 border border-dashed border-border p-6 text-sm text-muted-foreground",
        className,
      )}
    >
      <div>{children}</div>
      {action}
    </div>
  );
}

/**
 * A small tappable chip that opens detail ("Defence Industry Europe · 10-22"). A soft fill, not
 * a border: a bordered box under a label reads as an input field.
 */
export function ChipButton({
  onClick,
  children,
  title,
  dim,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  dim?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 bg-secondary/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-default disabled:hover:bg-secondary/60 disabled:hover:text-muted-foreground pointer-coarse:min-h-8",
        dim && "opacity-60",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A notice that is also the way in: "7 possible duplicate groups - Review". The whole bar is the
 * button, so it is easy to hit on a phone, and it reports whether what it opens is open.
 */
export function Callout({
  title,
  children,
  action,
  onClick,
  expanded,
  tone = "accent",
}: {
  title: ReactNode;
  children?: ReactNode;
  action: ReactNode;
  onClick: () => void;
  expanded?: boolean;
  tone?: "accent" | "danger" | "primary";
}) {
  const tones = {
    accent: "border-accent/50 bg-accent/10 hover:border-accent text-accent",
    danger: "border-destructive/50 bg-destructive/10 hover:border-destructive text-destructive",
    primary: "border-primary/50 bg-primary/10 hover:border-primary text-primary",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cn(
        "flex w-full items-center justify-between gap-3 border px-3 py-2.5 text-left text-sm transition-colors",
        tones[tone],
      )}
    >
      <span className="min-w-0">
        <span className="font-semibold">{title}</span>
        {children && <span className="block text-muted-foreground">{children}</span>}
      </span>
      <span className="shrink-0 font-mono text-2xs uppercase tracking-wider">{action}</span>
    </button>
  );
}

/**
 * "Nothing here" inside a panel: one quiet line, so an empty section reads as checked-and-empty
 * rather than broken. Page-level emptiness, with a way out, is EmptyState.
 */
export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm italic text-muted-foreground/80", className)}>{children}</p>;
}

/** Small uppercase label over a group of controls or values ("Domain", "Supplier country"). */
export function Eyebrow({
  children,
  className,
  tone = "muted",
}: {
  children: ReactNode;
  className?: string;
  tone?: "muted" | "accent";
}) {
  return (
    <p
      className={cn(
        "font-mono text-2xs uppercase tracking-widest",
        tone === "accent" ? "text-accent" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Shared card surface: never wider than its column, long content wraps or truncates. */
export function Card({
  children,
  className,
  interactive = false,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  as?: "div" | "li" | "article";
}) {
  return (
    <Tag
      className={cn(
        "flex min-w-0 max-w-full flex-col overflow-hidden border border-border bg-card/80 [overflow-wrap:anywhere]",
        interactive && "transition-colors hover:border-primary",
        className,
      )}
    >
      {children}
    </Tag>
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
 * Shared list row: title + optional subtitle on top, meta and actions below on phones; one line
 * on wider screens. Pages pass content, never their own row layout.
 *
 * Two opt-ins for dense content: `stack` keeps the column layout at every width (a row whose
 * tags and buttons would crowd the title off one line rather than squeeze it to characters),
 * and `below` renders an inline panel inside the same row item - which implies stacking, since
 * a panel does not share the line.
 */
export function ListRow({
  title,
  subtitle,
  meta,
  actions,
  below,
  stack,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  below?: ReactNode;
  stack?: boolean;
  className?: string;
}) {
  const stacked = Boolean(stack) || below !== undefined;
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-2 py-3",
        !stacked && "sm:flex-row sm:items-center sm:gap-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <div className="min-w-0">{title}</div>
        {subtitle && <div className="min-w-0 text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {(meta || actions) && (
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-2",
            !stacked && "sm:shrink-0 sm:justify-end",
          )}
        >
          {meta}
          {actions}
        </div>
      )}
      {below && <div className="min-w-0">{below}</div>}
    </li>
  );
}
