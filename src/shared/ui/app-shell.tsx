import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, Plus, Search, X, Radar } from "lucide-react";
import { useDrones, useServices } from "@/shared/infra/services";
import { droneHaystack } from "@/shared/infra/storage/local-repository";
import { CountryBadge } from "@/shared/ui/country-badge";
import { buttonClass } from "@/shared/ui/button-class";
import { CommandSearch } from "@/shared/ui/command-search";
import { DesktopNav, MobileNav } from "@/shared/ui/main-nav";
import { Btn } from "@/shared/ui/primitives";

export function AppShell({ children }: { children: ReactNode }) {
  const svc = useServices();
  const [cmd, setCmd] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd((v) => !v);
      }
      if (e.key === "Escape") setCmd(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link
            to="/"
            className="flex items-center gap-2 font-mono text-sm font-bold tracking-widest text-primary"
          >
            <Radar className="h-5 w-5" /> DRONE//INT
          </Link>
          <DesktopNav />
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCmd(true)}
              className="hidden items-center gap-2 border border-border px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground lg:flex"
            >
              <Search className="h-3.5 w-3.5" /> Search <kbd className="text-[10px]">⌘K</kbd>
            </button>
            <Link to="/intake" className={buttonClass()}>
              <Plus className="h-3.5 w-3.5" /> Ingest
            </Link>
            <Btn
              size="icon"
              variant="quiet"
              className="lg:hidden"
              onClick={() => setCmd(true)}
              aria-label="Search"
            >
              <Search className="size-4" />
            </Btn>
            <button className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      {svc.storageWarning && (
        <div role="status" className="border-b border-amber-500/40 bg-amber-500/10">
          <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-2 text-xs">
            <span className="font-mono uppercase tracking-wider text-amber-500">Storage</span>
            <span className="flex-1 text-foreground/90">{svc.storageWarning}</span>
            <button
              onClick={svc.clearStorageWarning}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss storage warning"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      {drawer && (
        <div
          className="fixed inset-0 z-50 bg-background/80 lg:hidden"
          onClick={() => setDrawer(false)}
        >
          <aside
            className="ml-auto flex h-full w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto border-l border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="self-end" onClick={() => setDrawer(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                setDrawer(false);
                setCmd(true);
              }}
              className="flex items-center gap-2 border border-border px-2 py-2 font-mono text-xs"
            >
              <Search className="h-4 w-4" /> Search
            </button>
            <MobileNav onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <CommandSearch open={cmd} onClose={() => setCmd(false)} />
      {svc.storageError && !svc.attached ? (
        <section role="alert" className="mx-auto max-w-2xl px-4 py-16">
          <div className="border border-destructive/40 bg-destructive/5 p-6">
            <h1 className="font-mono text-sm uppercase tracking-widest text-destructive">
              Catalog unavailable
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">{svc.storageError}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Btn variant="ghost" onClick={() => window.location.reload()}>
                Reload
              </Btn>
              <Btn variant="danger" onClick={() => void svc.continueInBrowser()}>
                Continue in this browser
              </Btn>
            </div>
          </div>
        </section>
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      )}
    </div>
  );
}
