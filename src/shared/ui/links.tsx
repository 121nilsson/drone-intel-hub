import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Display host + path compactly, e.g. "t.me/channel/123". */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).slice(0, 80);
  } catch {
    return url;
  }
}

/** External link that always truncates within its container (mobile-safe). */
export function ExternalSourceLink({
  href,
  children,
  className,
}: {
  href: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-primary hover:underline",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children ?? shortUrl(href)}</span>
      <span aria-hidden className="shrink-0">↗</span>
    </a>
  );
}

/** Compact chip linking to a system dossier; long names truncate. */
export function SystemChip({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  return (
    <Link
      to="/systems/$id"
      params={{ id }}
      title={name}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center border border-border bg-card px-2 py-0.5 font-mono text-xs hover:border-primary hover:text-primary",
        className,
      )}
    >
      <span className="truncate">{name}</span>
    </Link>
  );
}
