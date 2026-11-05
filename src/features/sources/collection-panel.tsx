import { useServerFn } from "@tanstack/react-start";
import { Btn, Panel } from "@/shared/ui/primitives";
import { useServices } from "@/shared/infra/services";
import {
  getSyncState,
  triggerAutoSync,
  type SyncState,
} from "@/shared/infra/sources/source-sync.functions";
import {
  REANALYSIS_BATCH,
  requeueFailed,
  requeueStale,
  type WorkProgress,
} from "@/shared/infra/ingest/auto-ingest";
import { WorkStatus } from "./work-status";

/** Matches the cron in vite.config.ts. */
const AUTO_MIN = 10;

export function CollectionPanel({
  busy,
  setBusy,
  postgres,
  syncState,
  setSyncState,
  work,
  remote,
  stopped,
  pending,
  failed,
  stale,
  say,
  onSyncAll,
  onProcessQueue,
  onAddSource,
}: {
  busy: string | null;
  setBusy: (busy: string | null) => void;
  postgres: boolean;
  syncState: SyncState | null;
  setSyncState: (state: SyncState) => void;
  work: WorkProgress | null;
  remote: WorkProgress | null;
  stopped: string | null;
  pending: number;
  failed: number;
  stale: number;
  say: (message: string) => void;
  onSyncAll: () => Promise<void>;
  onProcessQueue: () => Promise<void>;
  onAddSource: () => void;
}) {
  const svc = useServices();
  const stateFn = useServerFn(getSyncState);
  const triggerFn = useServerFn(triggerAutoSync);
  return (
    <Panel title="Collection & analysis">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <Btn className="justify-center py-2.5" onClick={onSyncAll} disabled={!!busy}>
          {busy === "all" ? "Fetching…" : "Fetch all feeds"}
        </Btn>
        <Btn
          variant="ghost"
          className="justify-center py-2.5"
          disabled={!!busy || !postgres}
          title={
            postgres
              ? "Runs the server-side pass now, past the throttle the cron respects, and polls every source rather than only those due"
              : "Needs PostgreSQL (DATABASE_URL)"
          }
          onClick={async () => {
            setBusy("sync");
            try {
              const r = await triggerFn({ data: { force: true } });
              say(r.ran ? `Sync all now: ${r.reason}` : `Sync all now did not run: ${r.reason}`);
              try {
                setSyncState(await stateFn());
              } catch {
                /* the poll retries */
              }
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "sync" ? "Syncing…" : "Sync all now"}
        </Btn>
        <Btn
          variant="ghost"
          className="justify-center py-2.5"
          disabled={!!busy || pending === 0}
          onClick={async () => {
            setBusy("queue");
            try {
              await onProcessQueue();
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "queue" ? "Analysing…" : `Analyse queue (${pending})`}
        </Btn>
        {stale > 0 && (
          <Btn
            variant="ghost"
            className="justify-center py-2.5"
            disabled={!!busy}
            title="Posts analysed by an older pipeline. Auto-sync re-analyses them in batches once the live queue is empty; this queues the next batch now."
            onClick={() => {
              const n = requeueStale(svc.dispatches, REANALYSIS_BATCH);
              say(`Queued ${n} older post${n === 1 ? "" : "s"} for re-analysis.`);
            }}
          >
            {`Re-analyse older (${stale})`}
          </Btn>
        )}
        {failed > 0 && (
          <Btn
            variant="ghost"
            className="justify-center py-2.5"
            disabled={!!busy}
            title="Failed posts with text can be retried (transient provider failures reset the attempt budget)."
            onClick={() => {
              const n = requeueFailed(svc.dispatches);
              say(`Queued ${n} failed post${n === 1 ? "" : "s"} for retry.`);
            }}
          >
            {`Retry failed (${failed})`}
          </Btn>
        )}
        <Btn variant="ghost" className="justify-center py-2.5" onClick={onAddSource}>
          + Add source
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
      <WorkStatus local={work} remote={remote} pending={pending} stopped={stopped} />
      <p className="mt-3 text-xs text-muted-foreground">
        Fetching only saves new posts (public Telegram channels, RSS feeds, website headlines) to
        the archive — no AI yet. Analysing then works through the waiting posts in small batches:
        drone-related ones keep their full text and are linked to the systems they mention; others
        are reduced to a stub so they are never fetched again. A post that repeats a story already
        stored is kept as a stub too, so one story is analysed once however many sources carried it.
        X needs a paid API or an RSS bridge (X_BRIDGE_BASE) and is not supported by default.
      </p>
    </Panel>
  );
}
