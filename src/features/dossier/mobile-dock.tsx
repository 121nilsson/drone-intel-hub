import { Link } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Drone } from "@/entities/drone/types";
import { DOSSIER_SECTIONS } from "./dossier-sections";

export function MobileDock({ drone: d, counterparts }: { drone: Drone; counterparts: Drone[] }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border bg-background/95 p-2 backdrop-blur sm:hidden">
      {/* Compare would deep-link to an arbitrary fallback system when no counterpart is linked;
            hiding it keeps "Jump to…" and "Posts" as the honest two actions. */}
      {counterparts.length > 0 && (
        <Link
          data-testid="compare-link"
          to="/counterparts"
          search={{ a: d.id, b: counterparts[0]?.id ?? "" }}
          className="flex-1 border border-primary/50 py-2.5 text-center font-mono text-xs uppercase text-primary"
        >
          Compare
        </Link>
      )}
      <Link
        data-testid="source-posts-link"
        to="/dispatches"
        search={{ q: d.name }}
        className="flex-1 border border-border py-2.5 text-center font-mono text-xs uppercase text-muted-foreground"
      >
        Posts
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          className="flex-1 border border-border py-2.5 text-center font-mono text-xs uppercase text-muted-foreground hover:text-primary"
        >
          Jump to…
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="max-h-64 overflow-y-auto">
          {DOSSIER_SECTIONS.map((s) => (
            <DropdownMenuItem key={s.id} asChild>
              <a href={`#${s.id}`}>{s.label}</a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
