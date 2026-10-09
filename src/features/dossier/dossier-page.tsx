import { Link } from "@tanstack/react-router";
import { consensus } from "@/entities/drone/consensus";
import { ieeeLabel, natoLabel } from "@/entities/normalization/bands";
import { effectiveIeeeBands, effectiveNatoBands, linkIsFiber } from "@/entities/normalization/rf";
import { flag, type Drone } from "@/entities/drone/types";
import { useDrones } from "@/shared/infra/services";
import { ConfidenceTag, Panel, Tag } from "@/shared/ui/primitives";

export function SpecTable({ drone }: { drone: Drone }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <th className="pb-2">Attribute</th><th className="pb-2">Consensus</th><th className="pb-2">Spread</th><th className="pb-2">Sources</th><th className="pb-2">Conf.</th>
      </tr></thead>
      <tbody className="divide-y divide-border">
        {drone.specs.map((s) => {
          const c = consensus(s);
          return (
            <tr key={s.key}>
              <td className="py-2">{s.label} {s.discoveredBy === "ai" && <Tag tone="accent" className="ml-1">AI-discovered</Tag>}</td>
              <td className="py-2 font-mono text-primary">{c.display} {c.disputed && <Tag tone="danger" className="ml-1">Disputed</Tag>}</td>
              <td className="py-2 font-mono text-xs text-muted-foreground">{c.min !== undefined && c.min !== c.max ? `${c.min}–${c.max}` : "—"}</td>
              <td className="py-2 font-mono text-xs" title={s.claims.map((x) => `${x.raw ?? x.value}${x.normalized?.canonicalValue !== undefined && x.raw ? ` → ${x.normalized.canonicalValue} ${x.normalized.canonicalUnit ?? ""}` : ""} (${x.source})`).join("\n")}>{c.sources}</td>
              <td className="py-2"><ConfidenceTag level={c.confidence} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DossierPage({ id }: { id: string }) {
  const drones = useDrones();
  const d = drones.find((x) => x.id === id);
  if (!d) return <p className="text-muted-foreground">System not found. <Link to="/catalog" className="text-primary">Back to catalog</Link></p>;
  const counterparts = drones.filter((x) => d.counterpartIds.includes(x.id));
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap gap-2"><Tag tone="primary">{d.domain}</Tag><Tag>Origin {flag(d.origin)}</Tag>{d.manufacturer && <Tag tone="accent">{d.manufacturer}</Tag>}{d.operators.map((o) => <Tag key={o} tone="accent">Operator {flag(o)}</Tag>)}<Tag>{d.propulsion}</Tag></div>
        <h1 className="mt-3 text-3xl font-semibold md:text-4xl">{d.name} {d.cyrillic && <span className="text-muted-foreground">{d.cyrillic}</span>}</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">{d.summary}</p>
        {d.reference && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            <a href={d.reference.url} target="_blank" rel="noreferrer" className="underline">
              {d.reference.url.includes("wikipedia.org") ? "Wikipedia, CC BY-SA 4.0" : "Wikidata"}
            </a>
          </p>
        )}
        {(() => { const cost = d.specs.find((s) => s.key === "unit_cost"); return cost ? (
          <p className="mt-3 inline-flex items-center gap-2 border border-accent/40 px-3 py-1.5 font-mono text-sm"><span className="text-xs uppercase text-muted-foreground">Unit cost</span><span className="text-accent">{consensus(cost).display}</span><span className="text-xs text-muted-foreground">({cost.claims.length} src)</span></p>
        ) : null; })()}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Consensus specifications" className="lg:col-span-2"><SpecTable drone={d} /></Panel>
        <Panel title="Alias registry">
          <ul className="space-y-1 font-mono text-sm">
            <li><span className="text-muted-foreground">canonical</span> {d.name}</li>
            {d.cyrillic && <li><span className="text-muted-foreground">cyrillic</span> {d.cyrillic}</li>}
            {d.aliases.map((a) => <li key={a}><span className="text-muted-foreground">alias</span> {a}</li>)}
          </ul>
        </Panel>
        <Panel title="RF spectrum">
          <ul className="space-y-2">
            {d.rf.map((r, i) => {
              const ieee = effectiveIeeeBands(r).map(ieeeLabel);
              const nato = effectiveNatoBands(r).map(natoLabel);
              const fiber = linkIsFiber(r);
              return (
              <li key={i} className="flex items-start justify-between gap-2 text-sm" title={r.band}>
                <Tag tone={r.role === "antijam" ? "accent" : fiber ? "accent" : "default"}>{fiber ? "tether" : r.role}</Tag>
                <div className="flex-1 text-right">
                  <span className="font-mono">{r.freqMHz ? `${r.freqMHz[0]}–${r.freqMHz[1]} MHz` : r.band}</span>
                  {(ieee.length > 0 || nato.length > 0) && <p className="font-mono text-xs text-muted-foreground">{[...ieee, ...nato].join(" · ")}</p>}
                  {r.protocols?.length ? <p className="font-mono text-xs text-muted-foreground">{r.protocols.join(", ")}</p> : null}
                  {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                </div>
              </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Supply chain">
          <ul className="space-y-2 text-sm">
            {d.components.map((c, i) => <li key={i}><p>{c.part}</p><p className="font-mono text-xs text-muted-foreground">{c.manufacturer} · {flag(c.origin)}</p></li>)}
            {!d.components.length && <li className="text-muted-foreground">No components traced.</li>}
          </ul>
        </Panel>
        <Panel title="Counterparts">
          {counterparts.map((c) => <Link key={c.id} to="/counterparts" search={{ a: d.id, b: c.id }} className="block py-1 hover:text-primary">{c.name} <span className="font-mono text-xs text-muted-foreground">{flag(c.origin)}</span> →</Link>)}
          {!counterparts.length && <p className="text-sm text-muted-foreground">None linked.</p>}
        </Panel>
      </div>
      <Panel title="Spec evolution timeline">
        <ol className="relative ml-2 border-l border-border">
          {[...d.evolution].sort((a, b) => b.date.localeCompare(a.date)).map((e, i) => (
            <li key={i} className="mb-4 ml-4">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 border border-primary bg-background" />
              <p className="font-mono text-xs text-muted-foreground">{e.date.slice(0, 10)} · {e.kind}</p>
              <p className="text-sm">{e.description} <span className="font-mono text-xs text-muted-foreground">— {e.source}</span></p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
