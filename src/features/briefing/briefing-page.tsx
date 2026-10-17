import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { DOMAINS } from "@/entities/drone/types";
import type { Drone } from "@/entities/drone/types";
import { CountryBadge } from "@/shared/ui/country-badge";
import { useDispatches, useDrones, useServices } from "@/shared/infra/services";
import { buildBriefing } from "@/features/briefing/briefing-data";
import { NewClaim } from "@/features/briefing/briefing-data";
import {
  BRIEFING_SUMMARY_TTL_MS,
  readBriefingSummaryCache,
  writeBriefingSummaryCache,
} from "@/features/briefing/briefing-summary-cache";
import {
  fetchBriefingExecutiveSummary,
  storeBriefingExecutiveSummary,
} from "@/shared/infra/briefing.functions";
import { Btn, Loading, Num, Panel, Tag } from "@/shared/ui/primitives";
import { useRelatedIntel, RelatedChips } from "@/features/intel-graph";

export function BriefingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted)
    return (
      <p className="animate-pulse font-mono text-sm text-muted-foreground">Loading briefing…</p>
    );
  return <Briefing />;
}

function NewSpecClaimItem({ n, i }: { n: NewClaim; i: number }) {
  const relatedIntel = useRelatedIntel(n.drone.id);
  return (
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
      {relatedIntel && relatedIntel.edges.length > 0 && (
        <div className="mt-1">
          <RelatedChips edges={relatedIntel.edges} maxChips={2} />
        </div>
      )}
    </li>
  );
}

function NewSystemItem({ d }: { d: Drone }) {
  const relatedIntel = useRelatedIntel(d.id);
  return (
    <li key={d.id}>
      <Link
        to="/systems/$id"
        params={{ id: d.id }}
        className="flex justify-between gap-2 hover:text-primary"
      >
        <span className="min-w-0 truncate">{d.name}</span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {d.domain} · <CountryBadge code={d.origin} />
        </span>
      </Link>
      {relatedIntel && relatedIntel.edges.length > 0 && (
        <div className="mt-1 ml-6">
          <RelatedChips edges={relatedIntel.edges} maxChips={2} />
        </div>
      )}
    </li>
  );
}

function Briefing() {
  const drones = useDrones();
  const dispatches = useDispatches();
  const { summarizer, settings, aiConfigured, attached } = useServices();
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
  const [regenKey, setRegenKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const forceRegenRef = useRef(false);
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

    setGenerating(true);
    const force = forceRegenRef.current;
    forceRegenRef.current = false;

    (async () => {
      try {
        if (!force) {
          const remote = await fetchBriefingExecutiveSummary({ data: { context } });
          if (remote.status === "hit") {
            apply(remote.summary, remote.generatedAt, true);
            setGenerating(false);
            return;
          }

          const cached = readBriefingSummaryCache();
          if (cached) {
            apply(cached.summary, cached.generatedAt, false);
            setGenerating(false);
            return;
          }
        }

        if (id !== reqId.current) {
          setGenerating(false);
          return;
        }
        setSummary(null);
        setSummaryAt(null);
        setSummaryShared(false);

        const s = await summarizerRef.current.summarize(context);
        if (id !== reqId.current) {
          setGenerating(false);
          return;
        }
        const generatedAt = Date.now();
        apply(s, generatedAt, false);
        void storeBriefingExecutiveSummary({
          data: { context, summary: s, generatedAt },
        });
      } catch (e) {
        if (id === reqId.current) setErr(e instanceof Error ? e.message : String(e));
        setGenerating(false);
      }
    })();

    return () => {
      reqId.current = id + 1;
    };
  }, [context, regenKey]);

  // Until the store attaches, the brief reads as an empty week — hold a loading state instead.
  if (!attached) return <Loading label="Loading briefing…" />;

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border bg-card/80 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            New systems
          </p>
          <p className="mt-2 font-mono text-3xl text-primary">
            <Num>{brief.newSystems.length}</Num>
          </p>
        </div>
        <div className="border border-border bg-card/80 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Spec changes
          </p>
          <p className="mt-2 font-mono text-3xl text-primary">
            <Num>{brief.newClaims.length}</Num>
          </p>
        </div>
        <div className="border border-border bg-card/80 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Reported systems
          </p>
          <p className="mt-2 font-mono text-3xl text-primary">
            <Num>{brief.reported.length}</Num>
          </p>
        </div>
        <div className="border border-border bg-card/80 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Reports / outlets
          </p>
          <p className="mt-2 font-mono text-3xl text-primary">
            <Num>{brief.reports}</Num>
            <span className="text-base text-muted-foreground"> / {brief.outlets}</span>
          </p>
        </div>
      </div>

      <Panel
        title="Executive summary"
        right={
          <div className="flex items-center gap-2">
            <Tag tone={aiConfigured ? "primary" : "default"}>
              {aiConfigured ? settings.tier2Model : "local engine"}
            </Tag>
            <Btn
              variant="ghost"
              disabled={!summary}
              onClick={async () => {
                if (!summary) return;
                try {
                  await navigator.clipboard.writeText(summary);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard may be unavailable */
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Btn>
            <Btn
              variant="ghost"
              disabled={generating}
              onClick={() => {
                forceRegenRef.current = true;
                setRegenKey((k) => k + 1);
              }}
            >
              {generating ? "Regenerating…" : "Regenerate"}
            </Btn>
          </div>
        }
      >
        {err ? (
          <p className="text-sm text-destructive">{err}</p>
        ) : summary ? (
          <>
            <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
              {summary
                .split(/\n{2,}/)
                .map((para, i) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} className="whitespace-pre-line">
                    {para}
                  </p>
                ))}
            </div>
            {summaryAt && (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {summaryShared ? "Shared summary" : "Summary"} generated{" "}
                {new Date(summaryAt).toLocaleString()} · cached until{" "}
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
                      <Tag tone="primary" caps={false} mono={false}>
                        {s.name}
                      </Tag>
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
              <NewSpecClaimItem key={i} n={n} i={i} />
            ))}
            {!brief.newClaims.length && (
              <li className="text-sm text-muted-foreground">No new claims this week.</li>
            )}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Most reported this week"
          className="lg:col-span-2"
          contentClassName="max-h-[min(22rem,45vh)] overflow-y-auto"
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
        <Panel
          title="First seen in reporting"
          contentClassName="max-h-[min(22rem,45vh)] overflow-y-auto"
        >
          <ul className="space-y-2">
            {brief.newSystems.slice(0, 8).map((d) => (
              <NewSystemItem key={d.id} d={d} />
            ))}
            {brief.newSystems.length > 8 && (
              <li>
                <Link to="/catalog" className="font-mono text-xs text-primary hover:underline">
                  +{brief.newSystems.length - 8} more in catalog →
                </Link>
              </li>
            )}
            {!brief.newSystems.length && (
              <li className="text-sm text-muted-foreground">None this week.</li>
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
