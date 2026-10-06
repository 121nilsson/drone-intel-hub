import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { DOMAINS, type Domain } from "@/entities/drone/types";
import { PLATFORMS, type MonitoredSource, type SourcePlatform } from "@/entities/source/types";
import { sampleDispatch } from "@/entities/source/seed";
import { useServices, useSources } from "@/shared/infra/services";
import { fetchSourcePosts } from "@/shared/infra/source-fetch.functions";
import { getSyncState, type SyncState } from "@/shared/infra/source-sync.functions";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";
import { syncSource, type SyncReport } from "./auto-ingest";

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
  const [log, setLog] = useState<SyncReport[]>([]);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const svcRef = useRef(svc);
  svcRef.current = svc;

  const syncOne = useCallback(
    async (s: MonitoredSource) => {
      const sv = svcRef.current;
      const rep = await syncSource(
        s,
        (x) => fetchFn({ data: { platform: x.platform, handle: x.handle } }),
        {
          ...sv,
          escalationThreshold: sv.settings.escalationThreshold,
          autoMergeThreshold: sv.settings.autoMergeThreshold,
        },
        (ids) => {
          const cur = sv.sources.list().find((x) => x.id === s.id);
          sv.sources.update(s.id, { seenIds: [...ids, ...(cur?.seenIds ?? [])].slice(0, 500) });
        },
      );
      sv.sources.update(s.id, { lastFetched: new Date().toISOString(), lastError: rep.error });
      setLog((l) => [rep, ...l].slice(0, 30));
      return rep;
    },
    [fetchFn],
  );

  const syncAll = useCallback(async () => {
    setBusy("all");
    for (const s of svcRef.current.sources.list().filter((x) => x.platform !== "X"))
      await syncOne(s);
    setBusy(null);
    const st = await stateFn();
    setSyncState(st);
  }, [syncOne, stateFn]);

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
  const sample = (s: MonitoredSource) =>
    nav({ to: "/intake", search: { draft: sampleDispatch(s.domain), source: s.name } });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Panel title={`Monitored sources · ${sources.length}`}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Btn onClick={syncAll} disabled={!!busy}>
              {busy === "all" ? "Syncing…" : "Sync all now"}
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
                      {s.seenIds?.length ?? 0} posts seen
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
            Sync pulls real recent posts (public Telegram channels, RSS feeds, website headlines),
            skips ones already seen, keeps only drone-related posts and runs them through the
            two-tier extractor. Matches auto-merge; the rest land in the Intake queue. X needs a
            paid API and is not supported.
          </p>
        </Panel>
        {log.length > 0 && (
          <Panel title="Sync log">
            <ul className="space-y-1 font-mono text-xs">
              {log.map((r, i) => (
                <li key={i}>
                  {r.source}:{" "}
                  {r.error ? (
                    <span className="text-destructive">{r.error}</span>
                  ) : (
                    `${r.fetched} new · ${r.relevant} drone-related · ${r.merged} merged · ${r.queued} queued`
                  )}
                </li>
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
