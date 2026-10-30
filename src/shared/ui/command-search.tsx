import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { useDrones, useServices } from "@/shared/infra/services";
import { droneHaystack } from "@/shared/infra/storage/local-repository";
import { cn } from "@/lib/utils";
import { CountryBadge } from "./country-badge";
import { NAV_PAGES } from "./nav-pages";

type Hit =
  | { kind: "page"; key: string; to: string; label: string; hint: string }
  | {
      kind: "system";
      key: string;
      id: string;
      name: string;
      sub: string;
      domain: string;
      origin: string;
    };

/**
 * ⌘K: systems by any of their names, and the pages themselves ("procurement", "taxonomy"), so
 * the keyboard reaches everything the menus do. Arrow keys move, Enter opens.
 */
export function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drones = useDrones();
  const { attached } = useServices();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const nav = useNavigate();
  if (!open || !attached) return null;
  const needle = q.trim().toLowerCase();
  const pages: Hit[] = NAV_PAGES.filter(
    (p) => !needle || `${p.label} ${p.hint}`.toLowerCase().includes(needle),
  )
    .slice(0, needle ? 4 : 0)
    .map((p) => ({ kind: "page", key: `p:${p.to}`, ...p }));
  const systems: Hit[] = drones
    .filter((d) => droneHaystack(d).includes(needle))
    .slice(0, 8)
    .map((d) => ({
      kind: "system",
      key: `s:${d.id}`,
      id: d.id,
      name: d.name,
      sub: d.cyrillic ?? "",
      domain: d.domain,
      origin: d.origin,
    }));
  const hits = [...pages, ...systems];
  const sel = Math.min(at, Math.max(0, hits.length - 1));
  const go = (h: Hit) => {
    onClose();
    setQ("");
    setAt(0);
    if (h.kind === "page") void nav({ to: h.to });
    else void nav({ to: "/systems/$id", params: { id: h.id } });
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 p-4 pt-16 sm:pt-24"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="w-full max-w-xl border border-primary/40 bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((i) => Math.min(i + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && hits[sel]) go(hits[sel]);
            }}
            placeholder="System, alias, Cyrillic name, or a page…"
            aria-label="Search systems and pages"
            className="w-full bg-transparent py-3 font-mono text-sm outline-none"
          />
          <kbd className="text-2xs text-muted-foreground">ESC</kbd>
        </div>
        <ul className="max-h-[60vh] overflow-auto py-1" role="listbox" aria-label="Results">
          {hits.map((h, i) => (
            <li key={h.key} role="option" aria-selected={i === sel}>
              <button
                type="button"
                onMouseEnter={() => setAt(i)}
                onClick={() => go(h)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left pointer-coarse:py-3",
                  i === sel && "bg-secondary",
                )}
              >
                {h.kind === "page" ? (
                  <>
                    <span className="min-w-0">
                      <span className="font-medium">{h.label}</span>{" "}
                      <span className="text-sm text-muted-foreground">{h.hint}</span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </>
                ) : (
                  <>
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{h.name}</span>{" "}
                      <span className="text-muted-foreground">{h.sub}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      {h.domain} · <CountryBadge code={h.origin} />
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-3 py-4 text-sm text-muted-foreground">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
