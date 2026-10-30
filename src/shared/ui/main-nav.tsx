import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, SETTINGS, type NavPage } from "./nav-pages";

const onPath = (path: string, to: string) =>
  to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);

function usePath() {
  return useRouterState({ select: (s) => s.location.pathname });
}

const triggerCls =
  "inline-flex items-center gap-1 px-2 py-1.5 font-mono text-xs tracking-wide transition-colors";

/** Desktop: one menu per group; the group holding the current page reads as active. */
export function DesktopNav() {
  const path = usePath();
  return (
    <nav aria-label="Main" className="hidden flex-1 items-center gap-1 lg:flex">
      {NAV_GROUPS.map((g) => {
        const active = [...g.pages.map((p) => p.to), ...(g.also ?? [])].some((to) =>
          onPath(path, to),
        );
        const current = g.pages.find((p) => onPath(path, p.to));
        return (
          <DropdownMenu key={g.label} modal={false}>
            <DropdownMenuTrigger
              className={cn(
                triggerCls,
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
              {current && <span className="text-muted-foreground">· {current.label}</span>}
              <ChevronDown className="size-3.5 opacity-70" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-64 rounded-none border-border bg-card p-1"
            >
              {g.pages.map((p) => (
                <DropdownMenuItem
                  key={p.to}
                  asChild
                  className="rounded-none focus:bg-secondary focus:text-foreground"
                >
                  <Link to={p.to} className="flex flex-col items-start gap-0">
                    <span className={cn("text-sm", onPath(path, p.to) && "text-primary")}>
                      {p.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{p.hint}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
      <Link
        to={SETTINGS.to}
        className={cn(
          triggerCls,
          onPath(path, SETTINGS.to)
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {SETTINGS.label}
      </Link>
    </nav>
  );
}

/** Phone and tablet drawer: the same groups as headings, every page one tap away. */
export function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  const path = usePath();
  const item = (p: NavPage) => (
    <Link
      key={p.to}
      to={p.to}
      onClick={onNavigate}
      className={cn(
        "block px-2 py-2 text-sm",
        onPath(path, p.to) ? "bg-primary/10 text-primary" : "text-foreground/90 hover:bg-secondary",
      )}
    >
      {p.label}
    </Link>
  );
  return (
    <nav aria-label="Main" className="space-y-4">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-2 font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            {g.label}
          </p>
          {g.pages.map(item)}
        </div>
      ))}
      <div className="border-t border-border pt-3">{item(SETTINGS)}</div>
    </nav>
  );
}
