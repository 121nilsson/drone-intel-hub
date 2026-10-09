import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOMAINS, type Domain } from "@/entities/drone/types";
import { PLATFORMS, type MonitoredSource, type SourcePlatform } from "@/entities/source/types";
import { sampleDispatch } from "@/entities/source/seed";
import { useDispatches, useServices, useSources } from "@/shared/infra/services";
import type { DispatchStatus } from "@/entities/dispatch/types";
import { fetchSourcePosts } from "@/shared/infra/source-fetch.functions";
import { FETCH_CONCURRENCY, sourceHost } from "@/shared/infra/fetch-posts";
import { mapWithConcurrency } from "@/shared/infra/pool";
import { getSyncState, type SyncState } from "@/shared/infra/source-sync.functions";
import { getStoreStatus } from "@/shared/infra/store.functions";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";
import {
  collectSource,
  fetchingProgress,
    processPending,
  progressFromItem,
  WORK_STALE_MS,
  type WorkProgress,
} from "./auto-ingest";

const field =
  "w-full min-w-0 max-w-full border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";
/** Matches the cron in vite.config.ts. */
const AUTO_MIN = 10;


function progressAge(progress: WorkProgress): number | null {
  const age = Date.now() - Date.parse(progress.updatedAt);
  return Number.isFinite(age) ? age : null;
}

function isActive(progress: WorkProgress | null): progress is WorkProgress {
  return !!progress && (progress.phase === "fetching" || progress.phase === "analysing");
}

/** A heartbeat still inside one provider attempt budget. */
function isLive(progress: WorkProgress | null): progress is WorkProgress {
  if (!isActive(progress)) return false;
  const age = progressAge(progress);
  return age !== null && age <= WORK_STALE_MS;
}

function isStalled(progress: WorkProgress | null): progress is WorkProgress {
  if (!isActive(progress)) return false;
  const age = progressAge(progress);
  return age !== null && age > WORK_STALE_MS;
}

function formatWork(progress: WorkProgress): string {
  if (progress.phase === "analysing")
    return `Analysing · ${progress.current} · ${progress.index} of ${progress.total} · ${progress.remaining} waiting`;
  return `Fetching · ${progress.current} · ${progress.index} of ${progress.total}`;
}

function WorkStatus({
  local,
  remote,
  pending,
  stopped,
}: {
  local: WorkProgress | null;
  remote: WorkProgress | null;
  pending: number;
  stopped: string | null;
}) {
  const lines: { key: string; text: string; tone: "live" | "stalled" | "idle" }[] = [];
  if (local && local.phase !== "done")
    lines.push({ key: "local", text: formatWork(local), tone: "live" });
  if (isLive(remote))
    lines.push({ key: "remote", text: `Auto-sync · ${formatWork(remote)}`, tone: "live" });
  else if (isStalled(remote))
    lines.push({
      key: "remote",
      text: `Auto-sync stalled · ${formatWork(remote)}`,
      tone: "stalled",
    });
  if (lines.length === 0)
    lines.push(
      stopped
        ? {
            key: "stopped",
            text: `Stopped · ${stopped} · ${pending} waiting`,
            tone: "stalled",
          }
        : { key: "idle", text: `Idle · ${pending} waiting`, tone: "idle" },
    );
  const toneClass = {
    live: "text-primary",
    stalled: "text-destructive",
    idle: "text-muted-foreground",
  } as const;
  return (
    <div className="mb-3 space-y-1 font-mono text-xs">
      {lines.map((line) => (
        <p key={line.key} className={toneClass[line.tone]}>
          {line.text}
        </p>
      ))}
    </div>
  );
}

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
  const [work, setWork] = useState<WorkProgress | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [postgres, setPostgres] = useState(false);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const dispatches = useDispatches();
  const svcRef = useRef(svc);
  svcRef.current = svc;
  // Stable per tab, not per call: a lease must survive re-renders so `finally` can release
  // the rows this tab actually claimed, and two tabs must never share an owner.
  const ownerRef = useRef<string>(crypto.randomUUID());
  const workRef = useRef<WorkProgress | null>(null);
  workRef.current = work;
  const lastReload = useRef(0);
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
          : `${s.name}: ${c.fetched} fetched · ${c.stored} new · ${c.duplicates} duplicates · ${c.durationMs}ms`,
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
      autoPromoteThreshold: sv.settings.autoPromoteThreshold,
      autoDiscardThreshold: sv.settings.autoDiscardThreshold,
    };
    try {
      const p = await processPending(sv.dispatches, deps, 20, {
        owner: ownerRef.current,
        onItem: (event) => setWork(progressFromItem(event)),
      });
      // Claimed 0 while work remains means another worker (usually the cron task) holds every
      // pending dispatch right now - worth saying, or the button looks broken.
      if (p.leased === 0 && p.remaining > 0) {
        setStopped(null);
        say(
          `Queue: nothing claimed - another run holds all ${p.remaining} pending. Try again shortly.`,
        );
        return;
      }
      setStopped(p.stopReason ?? null);
      say(
        `Queue: ${p.processed} analysed (${p.merged} merged, ${p.promoted} promoted, ${p.discarded} discarded, ${p.queued} queued) · ${p.irrelevant} not drone-related · ${p.failed ? `${p.failed} failed${p.stopReason ? ` · ${p.stopReason}` : ""} · ` : ""}${p.remaining} waiting`,
      );
    } finally {
      setWork(null);
    }
  }, []);

  const syncOne = useCallback(
    async (s: MonitoredSource) => {
      setWork(fetchingProgress(s.name, 1, 1));
      try {
        await collectOne(s);
        await processQueue();
      } finally {
        setWork(null);
      }
    },
    [collectOne, processQueue],
  );

  const syncAll = useCallback(async () => {
    setBusy("all");
    const list = svcRef.current.sources.list().filter((x) => x.platform !== "X");
    try {
      // Parallel lanes, one in-flight request per host: the same shape as the server's collection
      // pass, so a slow source no longer queues up behind 78 others before the queue is touched.
      await mapWithConcurrency(list, FETCH_CONCURRENCY, collectOne, {
        key: sourceHost,
        onSettled: (p) => setWork(fetchingProgress(p.item.name, p.done, p.total)),
      });
    } finally {
      setWork(null);
      setBusy(null);
    }
    try {
      setSyncState(await stateFn());
    } catch {
      /* the poll retries */
    }
  }, [collectOne, stateFn]);

  useEffect(() => {
    getStoreStatus()
      .then((s) => setPostgres(s.postgres))
      .catch(() => setPostgres(false));
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      stateFn()
        .then((st) => {
          if (!stop) setSyncState(st);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [stateFn]);

  // While the server run is live and this tab is idle, refresh caches so pending counts move.
  // At most every 10s. Skip the snapshot if this tab started writing during the load.
  useEffect(() => {
    if (!isLive(syncState?.progress ?? null) || workRef.current) return;
    const now = Date.now();
    if (now - lastReload.current < 10_000) return;
    lastReload.current = now;
    const apply = () => workRef.current === null;
    void svcRef.current.dispatches.reload(apply);
    void svcRef.current.sources.reload(apply);
  }, [syncState]);

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
  // Every status is listed explicitly. The object literal used to lean on an `as` cast, which meant
  // a status added to the union later counted as NaN in this tab instead of failing to compile.
  const counts: Record<DispatchStatus, number> = {
    pending: 0,
    processed: 0,
    irrelevant: 0,
    failed: 0,
    duplicate: 0,
  };
  for (const d of dispatches) counts[d.status]++;

  /**
   * Per-source dispatch breakdown. Computed once for the whole archive rather than per source row,
   * which would rescan every dispatch for each of ~79 sources on every render.
   */
  const yieldBySource = useMemo(() => {
    type Yield = {
      stored: number;
      waiting: number;
      analysed: number;
      queued: number;
      filtered: number;
      duplicates: number;
      failed: number;
    };
    const empty = (): Yield => ({
      stored: 0,
      waiting: 0,
      analysed: 0,
      queued: 0,
      filtered: 0,
      duplicates: 0,
      failed: 0,
    });
    const bySource = new Map<string, Yield>();
    for (const d of dispatches) {
      const y = bySource.get(d.sourceId) ?? empty();
      y.stored++;
      if (d.status === "processed") y.analysed++;
      else if (d.status === "irrelevant") y.filtered++;
      else if (d.status === "duplicate") y.duplicates++;
      else if (d.status === "failed") y.failed++;
      else if (d.status === "pending") y.waiting++;
      if (d.outcome === "queued") y.queued++;
      bySource.set(d.sourceId, y);
    }
    return bySource;
  }, [dispatches]);

  /** Sources that have produced at least one drone-related post - the "worth polling" answer. */
  const productiveSources = sources.filter((s) => {
    const y = yieldBySource.get(s.id);
    return !!y && y.analysed + y.queued > 0;
  }).length;
  const visibleSources = sources.filter((s) =>
    `${s.name} ${s.handle} ${s.platform} ${s.domain}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const remote = syncState?.progress ?? null;
  const workingIds = new Set<string>();
  if (work?.phase === "analysing" && work.currentId) workingIds.add(work.currentId);
  if (isLive(remote) && remote.phase === "analysing" && remote.currentId)
    workingIds.add(remote.currentId);
  const sample = (s: MonitoredSource) =>
    nav({ to: "/intake", search: { draft: sampleDispatch(s.domain), source: s.name } });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title={`Monitored sources · ${sources.length}`}>
        <Link to="/dispatches" className="mb-3 flex items-center justify-between border border-primary/40 px-3 py-2.5 font-mono text-xs uppercase text-primary">
          <span>Intel feed · {dispatches.length} posts · {counts.pending} waiting</span><span>→</span>
        </Link>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <Btn className="justify-center py-2.5" onClick={syncAll} disabled={!!busy}>
            {busy === "all" ? "Fetching…" : "Fetch all feeds"}
          </Btn>
          <Btn
            variant="ghost"
            className="justify-center py-2.5"
            disabled={!!busy || counts.pending === 0}
            onClick={async () => {
              setBusy("queue");
              try {
                await processQueue();
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "queue" ? "Analysing…" : `Analyse queue (${counts.pending})`}
          </Btn>
          <Btn
            variant="ghost"
            className="justify-center py-2.5"
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? "Close form" : "+ Add source"}
          </Btn>
          <Btn
            variant="ghost"
            className="justify-center py-2.5"
            onClick={() => {
              const count = svc.sources.addMissingDefaults?.() ?? 0;
              if (count > 0) {
                say(`Added ${count} default sources`);
              }
            }}
          >
            Load default sources
          </Btn>
          <span className="col-span-2 font-mono text-xs text-muted-foreground">
            Auto-sync runs server-side every {AUTO_MIN} minutes
            {!postgres
              ? " · needs PostgreSQL"
              : syncState?.lastSync
                ? ` · last run ${new Date(syncState.lastSync).toLocaleString()}`
                : " · not yet run"}
          </span>
          {syncState?.cooldownUntil && (
            <span className="font-mono text-xs text-destructive">
              Rate-limited · AI analysis paused until{" "}
              {new Date(syncState.cooldownUntil).toLocaleTimeString()}
            </span>
          )}
        </div>
        <WorkStatus local={work} remote={remote} pending={counts.pending} stopped={stopped} />
        {sources.length > 0 && (
          <p className="mb-3 font-mono text-xs text-muted-foreground">
            <span className="text-primary">{productiveSources}</span> of {sources.length} sources
            produced drone-related posts
          </p>
        )}
        <input
          className={field + " mb-2 py-2 text-sm"}
          placeholder={`Filter ${sources.length} sources…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="divide-y divide-border">
          {visibleSources.map((s) => (
            <li
              key={s.id}
              className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:flex-wrap sm:items-start"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Tag tone="primary">{s.platform}</Tag>
                  <Tag>{s.domain}</Tag>
                  {(() => {
                    // Collected plenty, produced nothing: the fetch works, the source is just
                    // noise, and this is the only place that says so.
                    const y = yieldBySource.get(s.id);
                    return y && y.analysed + y.queued === 0 && y.stored >= 20 ? (
                      <Tag
                        tone="danger"
                        title="Posts are collected but none turn out to be drone-related"
                      >
                        no signal
                      </Tag>
                    ) : null;
                  })()}
                </div>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{s.handle}</p>
                {s.notes && <p className="mt-1 text-sm text-muted-foreground">{s.notes}</p>}
                {s.lastFetched && (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Last synced {new Date(s.lastFetched).toLocaleString()} ·{" "}
                    {(() => {
                      const y = yieldBySource.get(s.id);
                      if (!y) return "0 posts stored";
                      return [
                        `${y.stored} stored`,
                        y.waiting ? `${y.waiting} waiting` : "",
                        `${y.analysed} analysed`,
                        y.queued ? `${y.queued} queued` : "",
                        y.filtered ? `${y.filtered} filtered` : "",
                        y.duplicates ? `${y.duplicates} duplicates` : "",
                        y.failed ? `${y.failed} failed` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ");
                    })()}
                  </p>
                )}
                {s.lastError && (
                  <p className="mt-1 font-mono text-[11px] text-destructive">{s.lastError}</p>
                )}
              </div>
              <div className="grid grid-cols-4 items-center gap-2 sm:flex sm:flex-wrap">
                <label
                  className="flex items-center gap-1 font-mono text-xs text-muted-foreground"
                  title="Include this source in the scheduled server-side auto-sync"
                >
                  <input
                    type="checkbox"
                    checked={s.autoSync !== false}
                    disabled={s.platform === "X"}
                    onChange={(e) => svc.sources.update(s.id, { autoSync: e.target.checked })}
                  />
                  Auto
                </label>
                <Btn
                  disabled={!!busy || s.platform === "X"}
                  onClick={async () => {
                    setBusy(s.id);
                    try {
                      await syncOne(s);
                    } finally {
                      setBusy(null);
                    }
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
          Fetching only saves new posts (public Telegram channels, RSS feeds, website headlines) to
          the archive — no AI yet. Analysing then works through the waiting posts in small batches:
          drone-related ones keep their full text and are linked to the systems they mention; others
          are reduced to a stub so they are never fetched again. A post that repeats a story already
          stored is kept as a stub too, so one story is analysed once however many sources carried
          it. X needs a paid API or an RSS bridge (X_BRIDGE_BASE) and is not supported by default.
        </p>
      </Panel>
      <div className="min-w-0 space-y-6">
        <Panel title="Add source" className={showAdd ? "" : "hidden lg:block"}>
          <div className="min-w-0 space-y-3">
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
    </div>
  );
}
