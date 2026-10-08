import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { DOMAINS, flag } from "@/entities/drone/types";
import { useCandidates, useDrones, useServices } from "@/shared/infra/services";
import {
  BRIEFING_SUMMARY_TTL_MS,
  readBriefingSummaryCache,
  writeBriefingSummaryCache,
} from "@/features/briefing/briefing-summary-cache";
import {
  fetchBriefingExecutiveSummary,
  storeBriefingExecutiveSummary,
} from "@/shared/infra/briefing.functions";
import { Panel, Tag } from "@/shared/ui/primitives";

const WEEK = 7 * 86400000;

export function BriefingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted)
    return (
      <p className="animate-pulse font-mono text-sm text-muted-foreground">Loading briefing…</p>
    );
  return <Briefing />;
}

function Briefing() {
  const drones = useDrones();
  const candidates = useCandidates();
  const { summarizer, settings, aiConfigured } = useServices();
  const [now] = useState(() => Date.now());
  const recent = (iso: string) => now - new Date(iso).getTime() < WEEK;

  const newSystems = drones.filter((d) => recent(d.createdAt));
  const drift = useMemo(
    () =>
      drones
        .flatMap((d) => d.evolution.filter((e) => recent(e.date)).map((e) => ({ ...e, drone: d })))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [drones],
  );
  const pulse = DOMAINS.map((dom) => ({
    dom,
    total: drones.filter((d) => d.domain === dom).length,
    updates: drift.filter((e) => e.drone.domain === dom).length,
  }));

  const pendingCount = candidates.filter((c) => c.status === "pending").length;
  const newNames = newSystems.map((d) => d.name).join(", ");
  // Memoised so unrelated re-renders never trigger a fresh (slow, paid) summary request.
  const context = useMemo(
    () => `Window: last 7 days. New systems: ${newNames || "none"}.
Spec drift events (${drift.length}): ${drift.map((e) => `${e.drone.name} [${e.kind}] ${e.description}`).join("; ")}.
Pending queue: ${pendingCount}.`,
    [newNames, drift, pendingCount],
  );
  const [summary, setSummary] = useState<string | null>(() => readBriefingSummaryCache()?.summary ?? null);
  const [summaryAt, setSummaryAt] = useState<number | null>(
    () => readBriefingSummaryCache()?.generatedAt ?? null,
  );
  const [summaryShared, setSummaryShared] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const summarizerRef = useRef(summarizer);
  summarizerRef.current = summarizer;
  // Summaries are slow (seconds to tens of seconds), so the context can change while one is in
  // flight. Without a guard the older response can land last and overwrite a newer one.
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    setErr(null);

    const apply = (s: string, generatedAt: number, shared: boolean) => {
      if (id !== reqId.current) return;
      writeBriefingSummaryCache({ summary: s, generatedAt });
      setSummary(s);
      setSummaryAt(generatedAt);
      setSummaryShared(shared);
    };

    (async () => {
      try {
        const remote = await fetchBriefingExecutiveSummary({ data: { context } });
        if (remote.status === "hit") {
          apply(remote.summary, remote.generatedAt, true);
          return;
        }

        const cached = readBriefingSummaryCache();
        if (cached) {
          apply(cached.summary, cached.generatedAt, false);
          return;
        }

        if (id !== reqId.current) return;
        setSummary(null);
        setSummaryAt(null);
        setSummaryShared(false);

        const s = await summarizerRef.current.summarize(context);
        if (id !== reqId.current) return;
        const generatedAt = Date.now();
        apply(s, generatedAt, false);
        if (remote.status === "miss") {
          void storeBriefingExecutiveSummary({
            data: { context, summary: s, generatedAt },
          });
        }
      } catch (e) {
        if (id === reqId.current) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      reqId.current = id + 1;
    };
  }, [context]);

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">
          7-day tactical intelligence briefing
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
          Unmanned systems: weekly shifts
        </h1>
      </div>

      <Panel
        title="Executive summary"
        right={
          <Tag tone={aiConfigured ? "primary" : "default"}>
            {aiConfigured ? settings.tier2Model : "local engine"}
          </Tag>
        }
      >
        {err ? (
          <p className="text-sm text-destructive">{err}</p>
        ) : summary ? (
          <>
            <p className="whitespace-pre-line leading-relaxed">{summary}</p>
            {summaryAt && (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {summaryShared ? "Shared summary" : "Summary"} cached until{" "}
                {new Date(summaryAt + BRIEFING_SUMMARY_TTL_MS).toLocaleString()} (refreshes about
                twice per day)
              </p>
            )}
          </>
        ) : (
          <p className="animate-pulse font-mono text-sm text-muted-foreground">
            Compiling briefing…
          </p>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pulse.map((p) => (
          <div key={p.dom} className="border border-border bg-card/80 p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {p.dom} domain
            </p>
            <p className="mt-2 font-mono text-3xl text-primary">{p.total}</p>
            <p className="font-mono text-xs text-muted-foreground">
              systems · <span className="text-accent">{p.updates} updates/7d</span>
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Spec drift feed" className="lg:col-span-2">
          <ul className="divide-y divide-border">
            {drift.map((e, i) => (
              <li key={i} className="flex flex-wrap items-start gap-3 py-2.5">
                <span className="w-14 font-mono text-xs text-muted-foreground">
                  {e.date.slice(5, 10)}
                </span>
                <Tag
                  className="w-24 justify-center"
                  tone={
                    e.kind === "frequency" ? "accent" : e.kind === "payload" ? "danger" : "primary"
                  }
                >
                  {e.kind}
                </Tag>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/systems/$id"
                    params={{ id: e.drone.id }}
                    className="font-medium hover:text-primary"
                  >
                    {e.drone.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {e.description} <span className="font-mono text-xs">— {e.source}</span>
                  </p>
                </div>
              </li>
            ))}
            {!drift.length && (
              <li className="py-2 text-sm text-muted-foreground">No drift recorded this week.</li>
            )}
          </ul>
        </Panel>
        <Panel title="Newly cataloged / promoted">
          <ul className="space-y-2">
            {newSystems.map((d) => (
              <li key={d.id}>
                <Link
                  to="/systems/$id"
                  params={{ id: d.id }}
                  className="flex justify-between hover:text-primary"
                >
                  <span>{d.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {d.domain} · {flag(d.origin)}
                  </span>
                </Link>
              </li>
            ))}
            {!newSystems.length && (
              <li className="text-sm text-muted-foreground">None this week.</li>
            )}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
