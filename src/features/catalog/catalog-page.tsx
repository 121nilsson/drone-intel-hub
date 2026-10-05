import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DOMAINS, flag, type Domain } from "@/entities/drone/types";
import { useDrones, useServices } from "@/shared/infra/services";
import type { CatalogFacets } from "@/shared/contracts/repository";
import { Tag } from "@/shared/ui/primitives";
import { cn } from "@/lib/utils";

function Facet({ label, options, value, onChange, render }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; render?: (o: string) => string }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return <button key={o} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn("border px-2 py-0.5 font-mono text-xs", on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{render ? render(o) : o}</button>;
        })}
      </div>
    </div>
  );
}

export function CatalogPage() {
  const drones = useDrones();
  const { drones: repo } = useServices();
  const [q, setQ] = useState("");
  const [f, setF] = useState<Required<CatalogFacets>>({ domains: [], origin: [], operators: [], bands: [], propulsion: [] });
  const opts = useMemo(() => ({
    origin: [...new Set(drones.map((d) => d.origin))],
    operators: [...new Set(drones.flatMap((d) => d.operators))],
    bands: [...new Set(drones.flatMap((d) => d.rf.map((r) => r.band)))],
    propulsion: [...new Set(drones.map((d) => d.propulsion))],
  }), [drones]);
  const results = useMemo(() => repo.search(q, f), [repo, q, f, drones]);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-5 border border-border bg-card/80 p-4">
        <Facet label="Domain" options={DOMAINS} value={f.domains} onChange={(v) => setF({ ...f, domains: v as Domain[] })} />
        <Facet label="Country of origin" options={opts.origin} value={f.origin} onChange={(v) => setF({ ...f, origin: v })} render={flag} />
        <Facet label="Battlefield operator" options={opts.operators} value={f.operators} onChange={(v) => setF({ ...f, operators: v })} render={flag} />
        <Facet label="RF band" options={opts.bands} value={f.bands} onChange={(v) => setF({ ...f, bands: v })} />
        <Facet label="Propulsion" options={opts.propulsion} value={f.propulsion} onChange={(v) => setF({ ...f, propulsion: v })} />
      </aside>
      <div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Geran, Герань, Shahed, Kometa, NVIDIA…"
          className="w-full border border-border bg-card px-3 py-2.5 font-mono text-sm outline-none focus:border-primary" />
        <p className="my-3 font-mono text-xs text-muted-foreground">{results.length} systems</p>
        <div className="grid gap-3 md:grid-cols-2">
          {results.map((d) => (
            <Link key={d.id} to="/systems/$id" params={{ id: d.id }} className="block border border-border bg-card/80 p-4 transition-colors hover:border-primary">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{d.name}</h3>
                  <p className="text-sm text-muted-foreground">{[d.cyrillic, ...d.aliases].filter(Boolean).join(" · ")}</p>
                </div>
                <Tag tone="primary">{d.domain}</Tag>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Tag>Origin {flag(d.origin)}</Tag>
                {d.operators.map((o) => <Tag key={o} tone="accent">Op {flag(o)}</Tag>)}
                {d.rf.slice(0, 3).map((r, i) => <Tag key={i}>{r.band}</Tag>)}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
