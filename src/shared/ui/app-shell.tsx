import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, Plus, Search, X, Radar } from "lucide-react";
import { useDrones } from "@/shared/infra/services";
import { droneHaystack } from "@/shared/infra/local-repository";
import { flag } from "@/entities/drone/types";

const NAV = [
  { to: "/", label: "Briefing" },
  { to: "/catalog", label: "Catalog" },
  { to: "/counterparts", label: "Counterparts" },
  { to: "/intake", label: "Queue" },
  { to: "/dispatches", label: "Feed" },
  { to: "/sources", label: "Sources" },
  { to: "/specs", label: "Spec Engine" },
  { to: "/taxonomy", label: "Taxonomy" },
  { to: "/settings", label: "Settings" },
] as const;

function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drones = useDrones();
  const [q, setQ] = useState("");
  const nav = useNavigate();
  if (!open) return null;
  const hits = drones.filter((d) => droneHaystack(d).includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-xl border border-primary/40 bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Cyrillic, alias, manufacturer…"
            className="w-full bg-transparent py-3 font-mono text-sm outline-none" />
          <kbd className="text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-auto">
          {hits.map((d) => (
            <li key={d.id}>
              <button className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-secondary"
                onClick={() => { onClose(); nav({ to: "/systems/$id", params: { id: d.id } }); }}>
                <span><span className="font-medium">{d.name}</span> <span className="text-muted-foreground">{d.cyrillic}</span></span>
                <span className="font-mono text-xs text-muted-foreground">{d.domain} · {flag(d.origin)}</span>
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-3 py-4 text-sm text-muted-foreground">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [cmd, setCmd] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((v) => !v); }
      if (e.key === "Escape") setCmd(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const linkCls = "font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground";
  const active = { className: "font-mono text-xs uppercase tracking-wider text-primary" };
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 font-mono text-sm font-bold tracking-widest text-primary">
            <Radar className="h-5 w-5" /> DRONE//INT
          </Link>
          <nav className="hidden flex-1 items-center gap-4 lg:flex">
            {NAV.map((n) => <Link key={n.to} to={n.to} className={linkCls} activeProps={active} activeOptions={{ exact: n.to === "/" }}>{n.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setCmd(true)} className="hidden items-center gap-2 border border-border px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground lg:flex">
              <Search className="h-3.5 w-3.5" /> Search <kbd className="text-[10px]">⌘K</kbd>
            </button>
            <Link to="/intake" className="inline-flex items-center gap-1 bg-primary px-3 py-1.5 font-mono text-xs uppercase text-primary-foreground hover:bg-primary/85">
              <Plus className="h-3.5 w-3.5" /> Ingest
            </Link>
            <button className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          </div>
        </div>
      </header>
      {drawer && (
        <div className="fixed inset-0 z-50 bg-background/80 lg:hidden" onClick={() => setDrawer(false)}>
          <aside className="ml-auto flex h-full w-64 flex-col gap-4 border-l border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <button className="self-end" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            <button onClick={() => { setDrawer(false); setCmd(true); }} className="flex items-center gap-2 border border-border px-2 py-2 font-mono text-xs"><Search className="h-4 w-4" /> Search</button>
            {NAV.map((n) => <Link key={n.to} to={n.to} onClick={() => setDrawer(false)} className={linkCls} activeProps={active} activeOptions={{ exact: n.to === "/" }}>{n.label}</Link>)}
          </aside>
        </div>
      )}
      <CommandSearch open={cmd} onClose={() => setCmd(false)} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
