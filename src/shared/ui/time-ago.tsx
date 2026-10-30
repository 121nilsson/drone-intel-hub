import { cn } from "@/lib/utils";
import { fullTime, relativeTime } from "./time";

/** A relative time with the exact one on hover, and machine-readable for assistive tech. */
export function TimeAgo({ iso, className }: { iso: string | undefined; className?: string }) {
  if (!iso) return <span className={className}>—</span>;
  return (
    <time
      dateTime={iso}
      title={fullTime(iso)}
      // Rendered on the server and again in the browser a moment later; the text may differ.
      suppressHydrationWarning
      className={cn("whitespace-nowrap", className)}
    >
      {relativeTime(iso)}
    </time>
  );
}
