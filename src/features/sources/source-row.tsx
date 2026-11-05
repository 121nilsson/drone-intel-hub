import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ExternalSourceLink } from "@/shared/ui/links";
import type { MonitoredSource } from "@/entities/source/types";
import { sampleDispatch } from "@/entities/source/seed";
import { useServices } from "@/shared/infra/use-services";
import { FAILURES_BEFORE_PAUSE, isPaused, reenable, silenceNotice } from "@/entities/source/health";
import { Switch } from "@/components/ui/switch";
import { TimeAgo } from "@/shared/ui/time-ago";
import { Btn, Tag } from "@/shared/ui/primitives";
import type { SourceYield } from "./sources-yield";

export function SourceRow({
  s,
  y,
  busy,
  onSync,
}: {
  s: MonitoredSource;
  y: SourceYield | undefined;
  busy: string | null;
  onSync: (s: MonitoredSource) => Promise<void>;
}) {
  const svc = useServices();
  const nav = useNavigate();
  const sample = (s: MonitoredSource) =>
    nav({ to: "/intake", search: { draft: sampleDispatch(s.domain), source: s.name } });
  return (
    <li className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:flex-wrap sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.name}</span>
          <Tag tone="primary">{s.platform}</Tag>
          <Tag>{s.domain}</Tag>
          {isPaused(s) && (
            <Tag tone="warning" title="Paused after repeated fetch failures">
              paused
            </Tag>
          )}
          {s.autoSync === false && (
            <Tag tone="danger" title="Excluded from scheduled auto-sync">
              auto off
            </Tag>
          )}
          {(() => {
            // Collected plenty, produced nothing: the fetch works, the source is just
            // noise, and this is the only place that says so.
            return y && y.analysed + y.queued === 0 && y.stored >= 20 ? (
              <Tag tone="danger" title="Posts are collected but none turn out to be drone-related">
                no signal
              </Tag>
            ) : null;
          })()}
        </div>
        {/^https?:\/\//i.test(s.handle) ? (
          <ExternalSourceLink href={s.handle} className="mt-1 flex font-mono text-xs" />
        ) : (
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{s.handle}</p>
        )}
        {s.notes && <p className="mt-1 text-sm text-muted-foreground">{s.notes}</p>}
        {s.lastFetched && (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Last synced <TimeAgo iso={s.lastFetched} /> ·{" "}
            {(() => {
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
        {silenceNotice(s) && (
          <p className="mt-1 font-mono text-[11px] text-accent">{silenceNotice(s)}</p>
        )}
        {isPaused(s) && (
          <p className="mt-1 font-mono text-[11px] text-accent">
            Paused after {FAILURES_BEFORE_PAUSE} failed fetches; retried automatically from{" "}
            {new Date(s.pausedUntil!).toLocaleDateString()}. A manual Sync that works resumes it
            now.
          </p>
        )}
        {s.disabledReason && s.autoSync === false && (
          <p className="mt-1 font-mono text-[11px] text-destructive">
            {s.disabledReason}. Tick Auto to turn it back on.
          </p>
        )}
      </div>
      <div className="grid grid-cols-4 items-center gap-2 sm:flex sm:flex-wrap">
        <label
          className="flex items-center gap-2 font-mono text-xs text-muted-foreground"
          title="Include this source in the scheduled server-side auto-sync"
        >
          <Switch
            checked={s.autoSync !== false}
            onCheckedChange={(checked) =>
              svc.sources.update(
                s.id,
                checked ? reenable() : { autoSync: false, pausedUntil: undefined },
              )
            }
          />
          Auto
        </label>
        {/* Ninety rows of solid green Sync buttons drowned the page; the actions are
            quiet and the source name carries the row. */}
        <Btn size="sm" variant="ghost" disabled={!!busy} onClick={() => onSync(s)}>
          {busy === s.id ? "Syncing…" : "Sync"}
        </Btn>
        <Btn size="sm" variant="quiet" onClick={() => sample(s)}>
          Sample
        </Btn>
        <Btn
          size="sm"
          variant="quiet"
          className="hover:text-destructive"
          onClick={() => {
            // Undo restores the exact pre-removal snapshot; nothing else depended on the
            // source between remove and undo in normal analyst reaction time.
            svc.sources.remove(s.id);
            toast("Source removed", {
              description: s.name,
              action: { label: "Undo", onClick: () => svc.sources.add(s) },
            });
          }}
        >
          Remove
        </Btn>
      </div>
    </li>
  );
}
