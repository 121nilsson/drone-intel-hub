import { useCallback, useEffect, useState } from "react";
import { fetchTaskStatus } from "@/shared/infra/evaluation/evaluation.functions";
import type { TaskRun, TaskStatus } from "@/shared/infra/task-runs.server";
import { Panel, Sparkline, Tag } from "@/shared/ui/primitives";

const REFRESH_MS = 30_000;

const TONE: Record<TaskRun["status"], "success" | "warning" | "danger" | "info" | "muted"> = {
  ok: "success",
  skipped: "muted",
  running: "info",
  alert: "warning",
  failed: "danger",
  interrupted: "danger",
};

function duration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

function relative(iso: string, now: number): string {
  const diff = Date.parse(iso) - now;
  const min = Math.round(Math.abs(diff) / 60_000);
  const text = min < 1 ? "under a minute" : min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

function RunLine({ run, now, prefix }: { run: TaskRun; now: number; prefix: string }) {
  return (
    <p className="break-words text-xs text-muted-foreground">
      {prefix} {relative(run.startedAt, now)}
      {run.trigger === "manual" && " (button)"}
      {run.durationMs !== undefined && ` · took ${duration(run.durationMs)}`}
      {run.summary && ` · ${run.summary}`}
    </p>
  );
}

function Job({ t, now }: { t: TaskStatus; now: number }) {
  const last = t.last;
  // The sync is throttled, so its latest run is often a skip; the last real run is what tells
  // whether ingestion is working.
  const showWorked = t.lastWorked && last?.status === "skipped";
  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{t.label}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{t.every}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.recentMs.length > 1 && <Sparkline values={t.recentMs} width={80} height={16} />}
          {t.typicalMs !== undefined && (
            <span className="font-mono text-[11px] text-muted-foreground">
              typically {duration(t.typicalMs)}
            </span>
          )}
          <Tag tone={last ? TONE[last.status] : "muted"} mono>
            {last ? last.status : "no runs yet"}
          </Tag>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t.does}</p>
      {last ? (
        <RunLine run={last} now={now} prefix="Last run" />
      ) : (
        <p className="text-xs text-muted-foreground">
          No run recorded yet. Runs are recorded from the first one after this release.
        </p>
      )}
      {showWorked && <RunLine run={t.lastWorked!} now={now} prefix="Last run that did work" />}
      {last?.error && <p className="break-words text-xs text-destructive">{last.error}</p>}
      {t.recentFailures > 0 && (
        <p className="text-xs text-destructive">
          {t.recentFailures} of the last 20 runs failed or were cut off.
        </p>
      )}
      {t.nextRunAt && (
        <p className="font-mono text-[11px] text-muted-foreground">
          next {relative(t.nextRunAt, now)} ({new Date(t.nextRunAt).toLocaleTimeString()})
        </p>
      )}
    </li>
  );
}

/** The server's background jobs: when each last ran, how long it took, and when it runs next. */
export function JobStatusPanel() {
  const [jobs, setJobs] = useState<TaskStatus[] | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    fetchTaskStatus()
      .then((rows) => {
        setJobs(rows);
        setNow(Date.now());
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!jobs) return null;
  const attention = jobs.filter(
    (j) =>
      j.last?.status === "failed" || j.last?.status === "interrupted" || j.last?.status === "alert",
  ).length;
  return (
    <Panel
      title="Automation status"
      right={
        <Tag tone={attention ? "danger" : "success"} mono>
          {attention ? `${attention} need attention` : "all running"}
        </Tag>
      }
    >
      <p className="text-xs text-muted-foreground">
        These jobs run on the server by themselves; nothing here needs a button. Each run is
        recorded, including runs started from a button, so a failure or a slowdown shows here. Times
        are the server&apos;s schedule, shown in your clock.
      </p>
      <ul className="mt-2 divide-y divide-border border-t border-border">
        {jobs.map((t) => (
          <Job key={t.name} t={t} now={now} />
        ))}
      </ul>
    </Panel>
  );
}
