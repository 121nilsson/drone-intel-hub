import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useDispatches, useServices, useSources } from "@/shared/infra/services";
import type { DispatchStatus } from "@/entities/dispatch/types";
import { getSyncState, type SyncState } from "@/shared/infra/source-sync.functions";
import { translateText } from "@/shared/infra/ai-proxy.functions";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";
import { formatProviderError } from "@/features/sources/auto-ingest";

const STATUSES = ["all", "pending", "processed", "irrelevant", "failed", "duplicate"] as const;
const field =
  "w-full min-w-0 border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary";

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;
  return (
    <div className="min-w-0">
      <p
        className={`mt-2 break-words text-sm leading-relaxed ${!expanded && isLong ? "line-clamp-4" : ""}`}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 py-1 font-mono text-xs text-muted-foreground hover:text-primary"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function TranslateButton({ text, model }: { text: string; model: string }) {
  const fn = useServerFn(translateText);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (out)
    return (
      <div className="mt-2 min-w-0 border-l-2 border-primary/30 pl-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          English translation
        </p>
        <p className="mt-0.5 break-words text-sm">{out}</p>
      </div>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Btn
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await fn({ data: { text, model } });
            if (r.ok) setOut(r.translated);
            else setErr(r.error);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Translation failed");
          }
          setBusy(false);
        }}
      >
        {busy ? "Translating…" : "Translate"}
      </Btn>
      {err && <span className="font-mono text-[11px] text-destructive">{err}</span>}
    </span>
  );
}

export function DispatchesPage() {
  const svc = useServices();
  const dispatches = useDispatches();
  const sources = useSources();
  const stateFn = useServerFn(getSyncState);
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");
  const [sourceId, setSourceId] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(20);
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = () =>
      stateFn()
        .then((s) => !stop && setSyncState(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [stateFn]);

  const counts = useMemo(() => {
    const c: Record<DispatchStatus, number> = {
      pending: 0,
      processed: 0,
      irrelevant: 0,
      failed: 0,
      duplicate: 0,
    };
    for (const d of dispatches) c[d.status]++;
    return c;
  }, [dispatches]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return dispatches.filter(
      (d) =>
        (filter === "all" || d.status === filter) &&
        (!sourceId || d.sourceId === sourceId) &&
        (!needle ||
          d.text.toLowerCase().includes(needle) ||
          d.sourceName.toLowerCase().includes(needle)),
    );
  }, [dispatches, filter, sourceId, q]);
  const shown = filtered.slice(0, limit);
  const remote = syncState?.progress;
  const workingId = remote?.phase === "analysing" ? remote.currentId : undefined;
  const byId = useMemo(() => new Map(dispatches.map((d) => [d.id, d])), [dispatches]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-bold uppercase tracking-widest">Intel feed</h1>
          <p className="text-sm text-muted-foreground">
            {dispatches.length} saved posts · {counts.pending} waiting for analysis
          </p>
        </div>
        <Link to="/sources" className="font-mono text-xs uppercase text-primary underline">
          Manage sources →
        </Link>
      </div>

      <div className="sticky top-14 z-30 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 font-mono text-xs">
          {STATUSES.map((k) => (
            <button
              key={k}
              onClick={() => {
                setFilter(k);
                setLimit(20);
              }}
              className={`shrink-0 border px-3 py-2 uppercase ${filter === k ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
            >
              {k} {k === "all" ? dispatches.length : counts[k]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className={field}
            placeholder="Search text…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(20);
            }}
          />
          <select
            className={field}
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setLimit(20);
            }}
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            Nothing here yet.{" "}
            <Link to="/sources" className="text-primary underline">
              Fetch some feeds
            </Link>
            .
          </p>
        </Panel>
      ) : (
        <ul className="space-y-3">
          {shown.map((d) => (
            <li key={d.id} className="min-w-0 border border-border bg-card/80 p-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
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
                {workingId === d.id && <Tag tone="primary">working</Tag>}
                <span className="font-medium text-foreground">{d.sourceName}</span>
                <span>{new Date(d.publishedAt ?? d.createdAt).toLocaleString()}</span>
              </div>
              {(d.droneIds?.length ||
                d.outcome === "queued" ||
                (d.status === "duplicate" && d.duplicateOf)) && (
                <div className="mt-2 flex flex-wrap gap-2 font-mono text-xs">
                  {d.droneIds?.map((id) => (
                    <Link
                      key={id}
                      to="/systems/$id"
                      params={{ id }}
                      className="border border-primary/50 px-2 py-1 text-primary"
                    >
                      {id}
                    </Link>
                  ))}
                  {d.outcome === "queued" && (
                    <Link to="/intake" className="border border-accent/50 px-2 py-1 text-accent">
                      In intake queue
                    </Link>
                  )}
                  {d.status === "duplicate" && d.duplicateOf && (
                    <span className="text-accent">
                      Duplicate of {byId.get(d.duplicateOf)?.sourceName ?? d.duplicateOf}
                    </span>
                  )}
                </div>
              )}
              {d.text && <ExpandableText text={d.text} />}
              {d.error && (
                <p className="mt-2 font-mono text-[11px] text-destructive">
                  {formatProviderError(d.error)}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {d.text && <TranslateButton text={d.text} model={svc.settings.translateModel} />}
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-muted-foreground underline"
                >
                  Open original ↗
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > shown.length && (
        <div className="flex flex-col items-center gap-2 py-2">
          <Btn
            variant="ghost"
            className="w-full justify-center py-2.5 sm:w-auto"
            onClick={() => setLimit((n) => n + 20)}
          >
            Show {Math.min(20, filtered.length - shown.length)} more
          </Btn>
          <span className="font-mono text-xs text-muted-foreground">
            {shown.length} of {filtered.length}
          </span>
        </div>
      )}
    </div>
  );
}
