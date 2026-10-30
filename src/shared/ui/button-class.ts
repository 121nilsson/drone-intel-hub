import { cn } from "@/lib/utils";

export type BtnVariant = "primary" | "ghost" | "danger" | "quiet" | "link";
export type BtnSize = "sm" | "md" | "icon";

/**
 * The button look as a class string, so a router Link that acts as a button ("Ingest", "Go to
 * sources") wears the same face as a <button>. Touch screens get a 40px minimum height: the
 * desktop sizes are below what a finger can hit reliably.
 */
export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: { variant?: BtnVariant; size?: BtnSize; className?: string | undefined } = {}) {
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/85",
    ghost: "border border-border text-foreground hover:bg-secondary",
    danger: "border border-destructive/60 text-destructive hover:bg-destructive/10",
    quiet: "text-muted-foreground hover:bg-secondary hover:text-foreground",
    // An action inside a sentence ("No matches. Clear filters"): reads as a link, no box.
    link: "p-0 font-sans text-primary hover:underline pointer-coarse:min-h-0",
  };
  // Sentence case on purpose: with every button, tag and heading in capitals nothing stood out,
  // so capitals are kept for labels (Panel titles, Tag, Eyebrow) and actions read as words.
  const s = {
    sm: "gap-1 px-2 py-1 text-xs pointer-coarse:min-h-9",
    md: "gap-1.5 px-3 py-1.5 text-xs pointer-coarse:min-h-10",
    icon: "size-7 justify-center p-0 pointer-coarse:size-10",
  };
  // Size before variant, so a variant that resets padding wins the merge.
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    s[size],
    v[variant],
    className,
  );
}
