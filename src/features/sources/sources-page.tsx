import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DOMAINS, type Domain } from "@/entities/drone/types";
import { PLATFORMS, type SourcePlatform } from "@/entities/source/types";
import { sampleDispatch } from "@/entities/source/seed";
import { useServices, useSources } from "@/shared/infra/services";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";

const field = "w-full border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";

export function SourcesPage() {
  const svc = useServices();
  const sources = useSources();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", platform: "Telegram" as SourcePlatform, handle: "", domain: "Air" as Domain, notes: "" });

  const add = () => {
    if (!f.name.trim() || !f.handle.trim()) return;
    svc.sources.add({ id: crypto.randomUUID(), ...f, name: f.name.trim(), handle: f.handle.trim() });
    setF({ ...f, name: "", handle: "", notes: "" });
  };
  const fetchLatest = (id: string, name: string, domain: Domain) => {
    svc.sources.update(id, { lastFetched: new Date().toISOString() });
    nav({ to: "/intake", search: { draft: sampleDispatch(domain), source: name } });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Panel title={`Monitored sources · ${sources.length}`}>
        <ul className="divide-y divide-border">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span><Tag tone="primary">{s.platform}</Tag><Tag>{s.domain}</Tag>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{s.handle}</p>
                {s.notes && <p className="mt-1 text-sm text-muted-foreground">{s.notes}</p>}
                {s.lastFetched && <p className="mt-1 font-mono text-[11px] text-muted-foreground">Last fetched {new Date(s.lastFetched).toLocaleString()}</p>}
              </div>
              <div className="flex gap-2">
                <Btn onClick={() => fetchLatest(s.id, s.name, s.domain)}>Load latest</Btn>
                <Btn variant="danger" onClick={() => svc.sources.remove(s.id)}>Remove</Btn>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">"Load latest" pulls a simulated sample dispatch into the intake box. Live fetching is not connected yet.</p>
      </Panel>
      <Panel title="Add source">
        <div className="space-y-3">
          <input className={field} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={field} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as SourcePlatform })}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
            <select className={field} value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}>{DOMAINS.map((d) => <option key={d}>{d}</option>)}</select>
          </div>
          <input className={field} placeholder="URL or @handle" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} />
          <textarea className={field} rows={3} placeholder="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <Btn onClick={add} disabled={!f.name.trim() || !f.handle.trim()}>Add to watchlist</Btn>
        </div>
      </Panel>
    </div>
  );
}
