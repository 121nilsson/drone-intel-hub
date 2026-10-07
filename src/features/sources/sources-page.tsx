import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { DOMAINS, type Domain } from "@/entities/drone/types";
import { PLATFORMS, type MonitoredSource, type SourcePlatform } from "@/entities/source/types";
import { sampleDispatch } from "@/entities/source/seed";
import { useDispatches, useServices, useSources } from "@/shared/infra/services";
import type { DispatchStatus } from "@/entities/dispatch/types";
import { fetchSourcePosts } from "@/shared/infra/source-fetch.functions";
import { getSyncState, type SyncState } from "@/shared/infra/source-sync.functions";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";
import { collectSource, processPending } from "./auto-ingest";

const field =
  "w-full border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";
/** Matches the cron in vite.config.ts. */
const AUTO_MIN = 15;

export function SourcesPage() {
  const svc = useServices();
  const sources = useSources();
  const nav = useNavigate();
  const fetchFn = useServerFn(fetchSourcePosts);
  const stateFn = useServerFn(getSyncState);
  const [f, setF] = useState({
    name: "",
    platform: "Telegram" as SourcePlatform,
    handle: "",
    domain: "Air" as Domain,
    notes: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");
  const dispatches = useDispatches();
  const svcRef = useRef(svc);
  svcRef.current = svc;
  // Stable per tab, not per call: a lease must survive re-renders so `finally` can release
  // the rows this tab actually claimed, and two tabs must never share an owner.
  const ownerRef = useRef<string>(crypto.randomUUID());
  const say = (m: string) => setLog((l) => [m, ...l].slice(0, 40));

  const collectOne = useCallback(
    async (s: MonitoredSource) => {
      const sv = svcRef.current;
      const c = await collectSource(
        s,
        (x) => fetchFn({ data: { platform: x.platform, handle: x.handle } }),
        sv.dispatches,
      );
      sv.sources.update(s.id, { lastFetched: new Date().toISOString(), lastError: c.error });
      say(
        c.error
          ? `${s.name}: ${c.error}`
          : `${s.name}: ${c.fetched} fetched · ${c.stored} new stored`,
      );
      return c;
    },
    [fetchFn],
  );

  const processQueue = useCallback(async () => {
    const sv = svcRef.current;
    const deps = {
      ...sv,
      escalationThreshold: sv.settings.escalationThreshold,
      autoMergeThreshold: sv.settings.autoMergeThreshold,
    };
    const p = await processPending(sv.dispatches, deps, 20, { owner: ownerRef.current });
    // Claimed 0 while work remains means another worker (usually the cron task) holds every
    // pending dispatch right now - worth saying, or the button looks broken.
    if (p.leased === 0 && p.remaining > 0) {
      say(
        `Queue: nothing claimed - another run holds all ${p.remaining} pending. Try again shortly.`,
      );
      return;
    }
    say(
      `Queue: ${p.processed} analysed (${p.merged} merged, ${p.queued} queued) · ${p.irrelevant} not drone-related · ${p.failed ? `${p.failed} failed · ` : ""}${p.remaining} waiting`,
    );
  }, []);

  const syncOne = useCallback(
    async (s: MonitoredSource) => {
      await collectOne(s);
      await processQueue();
    },
    [collectOne, processQueue],
  );

  const syncAll = useCallback(async () => {
    setBusy("all");
    for (const s of svcRef.current.sources.list().filter((x) => x.platform !== "X"))
      await collectOne(s);
    setBusy(null);
    const st = await stateFn();
    setSyncState(st);
  }, [collectOne, stateFn]);

  useEffect(() => {
    stateFn()
      .then(setSyncState)
      .catch(() => {});
  }, [stateFn]);

  const add = () => {
    if (!f.name.trim() || !f.handle.trim()) return;
    svc.sources.add({
      id: crypto.randomUUID(),
      ...f,
      name: f.name.trim(),
      handle: f.handle.trim(),
    });
    setF({ ...f, name: "", handle: "", notes: "" });
  };
  const counts = { pending: 0, processed: 0, irrelevant: 0, failed: 0 } as Record<
    DispatchStatus,
    number
  >;
  for (const d of dispatches) counts[d.status]++;
  const shown = dispatches.filter((d) => filter === "all" || d.status === filter).slice(0, 50);
  const sample = (s: MonitoredSource) =>
    nav({ to: "/intake", search: { draft: sampleDispatch(s.domain), source: s.name } });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Panel title={`Monitored sources · ${sources.length}`}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Btn onClick={syncAll} disabled={!!busy}>
              {busy === "all" ? "Fetching…" : "Fetch all feeds"}
            </Btn>
            <Btn
              variant="ghost"
              disabled={!!busy || counts.pending === 0}
              onClick={async () => {
                setBusy("queue");
                await processQueue();
                setBusy(null);
              }}
            >
              {busy === "queue" ? "Analysing…" : `Analyse queue (${counts.pending})`}
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                const count = svc.sources.addMissingDefaults?.() ?? 0;
                if (count > 0) {
                  say(`Added ${count} default sources`);
                }
              }}
            >
              Load default sources
            </Btn>
            <span className="font-mono text-xs text-muted-foreground">
              Auto-sync runs server-side every {AUTO_MIN} min
              {syncState?.configured
                ? syncState.lastSync
                  ? ` · last run ${new Date(syncState.lastSync).toLocaleString()}`
                  : " · not yet run"
                : " · needs PostgreSQL"}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Tag tone="primary">{s.platform}</Tag>
                    <Tag>{s.domain}</Tag>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {s.handle}
                  </p>
                  {s.notes && <p className="mt-1 text-sm text-muted-foreground">{s.notes}</p>}
                  {s.lastFetched && (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Last synced {new Date(s.lastFetched).toLocaleString()} ·{" "}
                      {dispatches.filter((d) => d.sourceId === s.id).length} posts stored
                    </p>
                  )}
                  {s.lastError && (
                    <p className="mt-1 font-mono text-[11px] text-destructive">{s.lastError}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    disabled={!!busy || s.platform === "X"}
                    onClick={async () => {
                      setBusy(s.id);
                      await syncOne(s);
                      setBusy(null);
                    }}
                  >
                    {busy === s.id ? "Syncing…" : "Sync"}
                  </Btn>
                  <Btn variant="ghost" onClick={() => sample(s)}>
                    Sample
                  </Btn>
                  <Btn variant="danger" onClick={() => svc.sources.remove(s.id)}>
                    Remove
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Fetching only saves new posts (public Telegram channels, RSS feeds, website headlines)
            to the archive — no AI yet. Analysing then works through the waiting posts in small
            batches: drone-related ones keep their full text and are linked to the systems they
            mention; others are reduced to a stub so they are never fetched again. X needs a paid
            API and is not supported.
          </p>
        </Panel>
        <Panel title={`Dispatch archive · ${dispatches.length}`}>
          <div className="mb-3 flex flex-wrap gap-2 font-mono text-xs">
            {(["all", "pending", "processed", "irrelevant", "failed"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`border px-2 py-1 ${filter === k ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >
                {k} {k === "all" ? dispatches.length : counts[k]}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here yet — fetch some feeds.</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((d) => (
                <li key={d.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <Tag
                      tone={
                        d.status === "processed"
                          ? "primary"
                          : d.status === "failed"
                            ? "danger"
                            : "default"
                      }
                    >
                      {d.status}
                    </Tag>
                    <span>{d.sourceName}</span>
                    <span>{new Date(d.publishedAt ?? d.createdAt).toLocaleString()}</span>
                    {d.droneIds?.map((id) => (
                      <a key={id} href={`/systems/${id}`} className="text-primary underline">
                        {id}
                      </a>
                    ))}
                    {d.outcome === "queued" && (
                      <a href="/intake" className="text-primary underline">
                        in intake queue
                      </a>
                    )}
                  </div>
                  {d.text && <p className="mt-1 line-clamp-3 text-sm">{d.text}</p>}
                  {d.error && (
                    <p className="mt-1 font-mono text-[11px] text-destructive">{d.error}</p>
                  )}
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all font-mono text-[11px] text-muted-foreground underline"
                  >
                    {d.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {log.length > 0 && (
          <Panel title="Activity log">
            <ul className="space-y-1 font-mono text-xs">
              {log.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <Panel title="Add source">
        <div className="space-y-3">
          <input
            className={field}
            placeholder="Name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className={field}
              value={f.platform}
              onChange={(e) => setF({ ...f, platform: e.target.value as SourcePlatform })}
            >
              {PLATFORMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select
              className={field}
              value={f.domain}
              onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}
            >
              {DOMAINS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <input
            className={field}
            placeholder="URL or @handle"
            value={f.handle}
            onChange={(e) => setF({ ...f, handle: e.target.value })}
          />
          <textarea
            className={field}
            rows={3}
            placeholder="Notes"
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
          <Btn onClick={add} disabled={!f.name.trim() || !f.handle.trim()}>
            Add to watchlist
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
