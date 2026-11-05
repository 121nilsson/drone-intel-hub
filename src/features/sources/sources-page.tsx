import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Domain } from "@/entities/drone/types";
import type { MonitoredSource, SourcePlatform } from "@/entities/source/types";
import { useDispatches, useServices, useSources } from "@/shared/infra/services";
import type { DispatchStatus } from "@/entities/dispatch/types";
import { fetchSourcePosts } from "@/shared/infra/sources/source-fetch.functions";
import { FETCH_CONCURRENCY, sourceHost } from "@/shared/infra/sources/fetch-posts";
import { mapWithConcurrency } from "@/shared/infra/sources/pool";
import { healthAfterFetch, isCollectable } from "@/entities/source/health";
import { getSyncState, type SyncState } from "@/shared/infra/sources/source-sync.functions";
import { getStoreStatus } from "@/shared/infra/storage/store.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/shared/ui/fields";
import { Btn, Loading, Panel } from "@/shared/ui/primitives";
import {
  collectSource,
  fetchingProgress,
  isStale,
  processPending,
  progressFromItem,
  type WorkProgress,
} from "@/shared/infra/ingest/auto-ingest";
import { isLive } from "./sources-work";
import { yieldBySourceOf } from "./sources-yield";
import { SourceRow } from "./source-row";
import { AddSourceForm, type SourceDraft } from "./source-add-form";
import { OutletReliabilityPanel } from "./outlet-reliability-panel";
import { CollectionPanel } from "./collection-panel";

export function SourcesPage() {
  const svc = useServices();
  const sources = useSources();
  const fetchFn = useServerFn(fetchSourcePosts);
  const stateFn = useServerFn(getSyncState);
  const [f, setF] = useState<SourceDraft>({
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
  const [tab, setTab] = useState("watchlist");
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
      sv.sources.update(s.id, {
        lastFetched: new Date().toISOString(),
        lastError: c.error,
        ...healthAfterFetch(s, c.error, Date.now(), c.fetched),
      });
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
      heuristicFirst: sv.settings.heuristicFirst,
      // Same as the cron task: an outage leaves posts pending rather than final and heuristic-only.
      deferOnOutage: true,
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

  const syncRow = async (s: MonitoredSource) => {
    setBusy(s.id);
    try {
      await syncOne(s);
    } finally {
      setBusy(null);
    }
  };

  const syncAll = useCallback(async () => {
    setBusy("all");
    // Same rule as auto-sync: off and paused sources are skipped; each still has its own Sync.
    const list = svcRef.current.sources
      .list()
      .filter((x) => x.platform !== "X" && isCollectable(x));
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
  const stale = dispatches.filter(isStale).length;

  const yieldBySource = useMemo(() => yieldBySourceOf(dispatches), [dispatches]);

  /** Sources that have produced at least one drone-related post - the "worth polling" answer. */
  const productiveSources = sources.filter((s) => {
    const y = yieldBySource.get(s.id);
    return !!y && y.analysed + y.queued > 0;
  }).length;
  const visibleSources = sources.filter((s) =>
    `${s.name} ${s.handle} ${s.platform} ${s.domain}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const remote = syncState?.progress ?? null;

  // Until the store attaches, an empty watchlist would tell the analyst to add sources when
  // their sources are simply still loading.
  if (!svc.attached) return <Loading label="Loading sources…" />;

  const sourceList = (
    <>
      {visibleSources.length === 0 && (
        <div className="py-3 text-sm text-muted-foreground">
          {sources.length === 0 ? (
            <p>
              No sources monitored yet.{" "}
              <Btn variant="link" onClick={() => setTab("add")}>
                Add your first source
              </Btn>
            </p>
          ) : (
            <p>No watched source matches the search.</p>
          )}
        </div>
      )}
      <ul className="divide-y divide-border">
        {visibleSources.map((s) => (
          <SourceRow key={s.id} s={s} y={yieldBySource.get(s.id)} busy={busy} onSync={syncRow} />
        ))}
      </ul>
    </>
  );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger
            value="watchlist"
            className="border border-border data-[state=active]:border-primary data-[state=active]:bg-primary/10"
          >
            Watchlist
          </TabsTrigger>
          <TabsTrigger
            value="collection"
            className="border border-border data-[state=active]:border-primary data-[state=active]:bg-primary/10"
          >
            Collection
          </TabsTrigger>
          <TabsTrigger
            value="add"
            className="border border-border data-[state=active]:border-primary data-[state=active]:bg-primary/10"
          >
            Add source
          </TabsTrigger>
        </TabsList>

        <TabsContent value="watchlist" className="mt-4">
          <Panel title={`Monitored sources · ${sources.length}`}>
            <Link
              to="/dispatches"
              className="mb-3 flex items-center justify-between border border-primary/40 px-3 py-2.5 font-mono text-xs uppercase text-primary"
            >
              <span>
                Intel feed · {dispatches.length} posts · {counts.pending} waiting
              </span>
              <span>→</span>
            </Link>
            {sources.length > 0 && (
              <p className="mb-3 font-mono text-xs text-muted-foreground">
                <span className="text-primary">{productiveSources}</span> of {sources.length}{" "}
                sources produced drone-related posts
              </p>
            )}
            <Input
              className="mb-2"
              aria-label="Filter sources"
              placeholder={`Filter ${sources.length} sources…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {sourceList}
          </Panel>
        </TabsContent>

        <TabsContent value="collection" className="mt-4 space-y-4">
          <OutletReliabilityPanel dispatches={dispatches} />
          <CollectionPanel
            busy={busy}
            setBusy={setBusy}
            postgres={postgres}
            syncState={syncState}
            setSyncState={setSyncState}
            work={work}
            remote={remote}
            stopped={stopped}
            pending={counts.pending}
            failed={counts.failed}
            stale={stale}
            say={say}
            onSyncAll={syncAll}
            onProcessQueue={processQueue}
            onAddSource={() => setTab("add")}
          />
          {log.length > 0 && (
            <Panel title="Activity log">
              <ul className="space-y-1 font-mono text-xs">
                {log.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="add" className="mt-4">
          <Panel title="Add source">
            <AddSourceForm f={f} setF={setF} onAdd={add} />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
