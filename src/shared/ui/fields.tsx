import { useId, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Form controls with one look. Selects stay native on purpose: on a phone the OS picker is
 * easier to use than any custom listbox, and it needs no portal or focus management.
 */
const control =
  "min-w-0 border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-foreground/30 focus:border-primary disabled:opacity-50 pointer-coarse:min-h-10";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(control, "w-full font-mono", className)} />;
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(control, "w-full font-mono", className)} />;
}

export function Select({
  className,
  size = "md",
  ...p
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "sm" | "md" }) {
  return (
    <select
      {...p}
      className={cn(
        control,
        "cursor-pointer font-mono",
        size === "sm" && "px-2 py-1 text-2xs pointer-coarse:min-h-9",
        className,
      )}
    />
  );
}

/** A labelled control: the label is real (<label for>), the hint sits under the control. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <label
        htmlFor={id}
        className="block font-mono text-2xs uppercase tracking-widest text-muted-foreground"
      >
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Search box with an icon and a clear button; the label is for screen readers only. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        // The inner input drops its own outline, so the box carries the focus ring instead.
        "flex min-w-0 items-center gap-2 border border-border bg-card px-3 transition-colors hover:border-foreground/30 focus-within:border-primary focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
