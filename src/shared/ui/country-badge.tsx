import { cn } from "@/lib/utils";

/** ISO 3166-1 alpha-2 → flag-icons `fi-xx` class (SVG sprites, works in Chrome on Windows). */
function flagIconClass(code: string): string | null {
  const iso = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return null;
  return `fi fi-${iso.toLowerCase()}`;
}

export function CountryBadge({
  code,
  showCode = true,
  className,
}: {
  code: string;
  showCode?: boolean;
  className?: string;
}) {
  let iso = code.trim().toUpperCase();
  if (code === "??") code = "xx";
  const fi = flagIconClass(code);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={iso}>
      {fi ? (
        <span
          className={cn(fi, "inline-block shrink-0 align-middle text-base leading-none")}
          aria-hidden
        />
      ) : (
        <span
          className="inline-block size-3 shrink-0 rounded-sm border border-border bg-muted"
          aria-hidden
        />
      )}
      {showCode && <span className="font-mono text-[0.92em]">{iso}</span>}
    </span>
  );
}
