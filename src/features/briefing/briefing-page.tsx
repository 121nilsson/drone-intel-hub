import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DOMAINS, flag } from "@/entities/drone/types";
import { useCandidates, useDrones, useServices } from "@/shared/infra/services";
import { Panel, Tag } from "@/shared/ui/primitives";

const WEEK = 7 * 86400000;

export function BriefingPage() {
  const drones = useDrones();
  const candidates = useCandidates();
  const { summarizer, settings } = useServices();
  const [now] = useState(() => Date.now());
  const recent = (iso: string) => now - new Date(iso).getTime() < WEEK;

  const newSystems = drones.filter((d) => recent(d.createdAt));
  const drift = useMemo(() => drones.flatMap((d) => d.evolution.filter((e) => recent(e.date)).map((e) => ({ ...e, drone: d })))
    .sort((a, b) => b.date.localeCompare(a.date)), [drones]);
  const pulse = DOMAINS.map((dom) => ({
    dom, total: drones.filter((d) => d.domain === dom).length,
    updates: drift.filter((e) => e.drone.domain === dom).length,
  }));

  const context = `Window: last 7 days. New systems: ${newSystems.map((d) => d.name).join(", ") || "none"}.
Spec drift events (${drift.length}): ${drift.map((e) => `${e.drone.name} [${e.kind}] ${e.description}`).join("; ")}.
Pending queue: ${candidates.filter((c) => c.status === "pending").length}.`;
  const [summary, setSummary] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setSummary(null); setErr(null);
    summarizer.summarize(context).then(setSummary).catch((e: Error) => setErr(e.message));
  }, [summarizer, context]);

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">7-day tactical intelligence briefing</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">Unmanned systems: weekly shifts</h1>
      </div>

      <Panel title="Executive summary" right={<Tag tone={settings.apiKey ? "primary" : "default"}>{settings.apiKey ? settings.tier2Model : "local engine"}</Tag>}>
        {err ? <p className="text-sm text-destructive">{err}</p> : summary ? <p className="whitespace-pre-line leading-relaxed">{summary}</p> : <p className="animate-pulse font-mono text-sm text-muted-foreground">Compiling briefing…</p>}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pulse.map((p) => (
          <div key={p.dom} className="border border-border bg-card/80 p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{p.dom} domain</p>
            <p className="mt-2 font-mono text-3xl text-primary">{p.total}</p>
            <p className="font-mono text-xs text-muted-foreground">systems · <span className="text-accent">{p.updates} updates/7d</span></p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Spec drift feed" className="lg:col-span-2">
          <ul className="divide-y divide-border">
            {drift.map((e, i) => (
              <li key={i} className="flex flex-wrap items-start gap-3 py-2.5">
                <span className="w-20 font-mono text-xs text-muted-foreground">{e.date.slice(5, 10)}</span>
                <Tag tone={e.kind === "frequency" ? "accent" : e.kind === "payload" ? "danger" : "primary"}>{e.kind}</Tag>
                <div className="min-w-0 flex-1">
                  <Link to="/systems/$id" params={{ id: e.drone.id }} className="font-medium hover:text-primary">{e.drone.name}</Link>
                  <p className="text-sm text-muted-foreground">{e.description} <span className="font-mono text-xs">— {e.source}</span></p>
                </div>
              </li>
            ))}
            {!drift.length && <li className="py-2 text-sm text-muted-foreground">No drift recorded this week.</li>}
          </ul>
        </Panel>
        <Panel title="Newly cataloged / promoted">
          <ul className="space-y-2">
            {newSystems.map((d) => (
              <li key={d.id}><Link to="/systems/$id" params={{ id: d.id }} className="flex justify-between hover:text-primary">
                <span>{d.name}</span><span className="font-mono text-xs text-muted-foreground">{d.domain} · {flag(d.origin)}</span>
              </Link></li>
            ))}
            {!newSystems.length && <li className="text-sm text-muted-foreground">None this week.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
