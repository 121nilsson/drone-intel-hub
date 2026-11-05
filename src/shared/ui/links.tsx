import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import { shortUrl } from "./link-text";

/** External link that always truncates within its container (mobile-safe). */
export function ExternalSourceLink({
  href,
  children,
  className,
}: {
  href: string;
  children?: ReactNode;
  className?: string | undefined;
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
      <span aria-hidden className="shrink-0">
        ↗
      </span>
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
  className?: string | undefined;
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

/** Source label: URLs become a truncated external link, other text wraps safely. */
export function SourceRef({
  source,
  href,
  className,
}: {
  source?: string | undefined;
  href?: string | undefined;
  className?: string | undefined;
}) {
  const s = (source ?? "").trim();
  const url = /^https?:\/\//i.test(s) ? s : href;
  if (url) {
    return (
      <ExternalSourceLink href={url} className={className}>
        {s && !/^https?:\/\//i.test(s) ? s : shortUrl(url)}
      </ExternalSourceLink>
    );
  }
  return <span className={cn("break-words [overflow-wrap:anywhere]", className)}>{s || "?"}</span>;
}
