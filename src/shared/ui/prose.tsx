import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Running text that comes from outside - a model's brief, a report, a pasted post. It may hold a
 * URL or a long token no space breaks, so it wraps anywhere instead of widening the page, and it
 * can shrink inside a flex or grid column. Page copy written by us does not need it.
 */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 space-y-3 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]",
        className,
      )}
    >
      {children}
    </div>
  );
}
