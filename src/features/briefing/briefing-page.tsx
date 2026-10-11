import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { DOMAINS, flag } from "@/entities/drone/types";
import { useDispatches, useDrones, useServices } from "@/shared/infra/services";
import { buildBriefing } from "@/features/briefing/briefing-data";
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
  const dispatches = useDispatches();
  const { summarizer, settings, aiConfigured } = useServices();
  const [now] = useState(() => Date.now());
  // Memoised so unrelated re-renders never rebuild the context (and with it, the summary request).
  const brief = useMemo(() => buildBriefing(drones, dispatches, now), [drones, dispatches, now]);
  const { context } = brief;
  const pulse = DOMAINS.map((dom) => ({
    dom,
    total: drones.filter((d) => d.domain === dom).length,
    reported: brief.reported.filter((r) => r.drone.domain === dom).length,
  }));
  const [summary, setSummary] = useState<string | null>(
    () => readBriefingSummaryCache()?.summary ?? null,
  );
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
              systems · <span className="text-accent">{p.reported} reported/7d</span>
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Most reported this week"
          className="lg:col-span-2"
          right={
            <span className="font-mono text-xs text-muted-foreground">
              {brief.reports} reports · {brief.outlets} outlets
            </span>
          }
        >
          <ul className="space-y-2">
            {brief.reported.slice(0, 12).map((r) => (
              <li key={r.drone.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  to="/systems/$id"
                  params={{ id: r.drone.id }}
                  className="font-semibold hover:text-primary"
                >
                  {r.drone.name}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">
                  {r.posts} report{r.posts === 1 ? "" : "s"} · {r.outlets.slice(0, 3).join(", ")}
                  {r.outlets.length > 3 ? ` +${r.outlets.length - 3}` : ""}
                </span>
              </li>
            ))}
            {!brief.reported.length && (
              <li className="text-sm text-muted-foreground">
                No catalogued system was named in this week&apos;s reports.
              </li>
            )}
          </ul>
        </Panel>
        <Panel title="First seen in reporting">
          <ul className="space-y-2">
            {brief.newSystems.map((d) => (
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
            {!brief.newSystems.length && (
              <li className="text-sm text-muted-foreground">None this week.</li>
            )}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Latest reports" className="lg:col-span-2">
          <ul className="space-y-2.5">
            {brief.headlines.map((h) => (
              <li key={h.id} className="border border-border bg-card/40 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {h.outlet}
                  </a>
                  <span className="font-mono text-xs text-muted-foreground">
                    {h.date.slice(5, 10)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{h.excerpt}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {h.systems.map((s) => (
                    <Link key={s.id} to="/systems/$id" params={{ id: s.id }}>
                      <Tag tone="primary">{s.name}</Tag>
                    </Link>
                  ))}
                </div>
              </li>
            ))}
            {!brief.headlines.length && (
              <li className="text-sm text-muted-foreground">No reports this week.</li>
            )}
          </ul>
        </Panel>
        <Panel title="New spec claims">
          <ul className="space-y-2">
            {brief.newClaims.slice(0, 20).map((n, i) => (
              <li key={i} className="text-sm">
                <Link
                  to="/systems/$id"
                  params={{ id: n.drone.id }}
                  className="font-semibold hover:text-primary"
                >
                  {n.drone.name}
                </Link>{" "}
                <span className="text-muted-foreground">{n.spec.label}:</span>{" "}
                <span className="font-mono">{String(n.claim.value)}</span>
                {n.disputed && (
                  <Tag tone="danger" className="ml-1.5 align-middle">
                    Disputed
                  </Tag>
                )}
                <p className="font-mono text-[11px] text-muted-foreground">
                  {n.claim.source.split(" · ")[0]}
                </p>
              </li>
            ))}
            {!brief.newClaims.length && (
              <li className="text-sm text-muted-foreground">No new claims this week.</li>
            )}
          </ul>
        </Panel>
      </div>

      <Panel title="Catalog changes">
        <ul className="space-y-2.5">
          {brief.drift.slice(0, 30).map((e, i) => {
            const tone =
              e.kind === "frequency" ? "accent" : e.kind === "payload" ? "danger" : "primary";
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {e.date.slice(5, 10)}
                </span>
                <Link
                  to="/systems/$id"
                  params={{ id: e.drone.id }}
                  className="font-semibold hover:text-primary"
                >
                  {e.drone.name}
                </Link>
                <Tag tone={tone}>{e.kind}</Tag>
                <span className="text-foreground/90">{e.description}</span>
              </li>
            );
          })}
          {!brief.drift.length && (
            <li className="text-sm text-muted-foreground">No changes from reporting this week.</li>
          )}
        </ul>
      </Panel>
    </div>
  );
}
