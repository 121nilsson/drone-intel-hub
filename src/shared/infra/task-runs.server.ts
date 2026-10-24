import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { SCHEDULED_TASKS } from "@/shared/contracts/scheduled-tasks";
import { nextCronRun } from "@/shared/infra/cron";

export type TaskTrigger = "schedule" | "manual";
/** `alert`: the job ran fine and found something a person should look at (a health regression). */
export type TaskRunStatus = "running" | "ok" | "skipped" | "alert" | "failed" | "interrupted";

export interface TaskOutcome {
  status: "ok" | "skipped" | "alert";
  summary: string;
}

export interface TaskRun {
  trigger: TaskTrigger;
  startedAt: string;
  durationMs?: number;
  status: TaskRunStatus;
  summary?: string;
  error?: string;
}

export interface TaskStatus {
  name: string;
  label: string;
  every: string;
  does: string;
  nextRunAt?: string;
  /** The most recent run, whatever it did. */
  last?: TaskRun;
  /** The most recent run that did work (not skipped), for "last did something". */
  lastWorked?: TaskRun;
  /** Median duration of recent runs that did work. */
  typicalMs?: number;
  /** Durations of recent runs that did work, oldest first, for a sparkline. */
  recentMs: number[];
  /** Failed or interrupted runs among the last 20. */
  recentFailures: number;
}

/** Rows older than this are dropped as new runs are recorded; the sync alone writes 144 a day. */
const KEEP_DAYS = 30;
/** A run with no finish after this long was cut off (a restart mid-run) rather than still going. */
const INTERRUPTED_AFTER_MS = 60 * 60_000;

/**
 * Run a background job and record how it went. Recording never decides the job's fate: without
 * a database, or when the log write fails, the job still runs and its result or error is passed
 * through unchanged.
 */
export async function recordTaskRun<T>(
  task: string,
  trigger: TaskTrigger,
  run: () => Promise<T>,
  outcome: (result: T) => TaskOutcome,
): Promise<T> {
  const id = await start(task, trigger);
  const started = Date.now();
  try {
    const result = await run();
    const o = outcome(result);
    await finish(id, Date.now() - started, o.status, o.summary);
    return result;
  } catch (e) {
    await finish(id, Date.now() - started, "failed", undefined, (e as Error)?.message ?? String(e));
    throw e;
  }
}

/** The usual outcome of a job that reports `{ ran, reason }`. */
export const ranOutcome = (r: { ran: boolean; reason: string }): TaskOutcome => ({
  status: r.ran ? "ok" : "skipped",
  summary: r.reason,
});

/** A health check that found a regression ran fine, and still needs a person. */
export const healthOutcome = (r: {
  ran: boolean;
  reason: string;
  regression: boolean;
  details: string[];
}): TaskOutcome =>
  r.regression
    ? { status: "alert", summary: `Regression: ${r.details.join("; ")}` }
    : { status: r.ran ? "ok" : "skipped", summary: r.details.join("; ") || r.reason };

export const shadowOutcome = (r: {
  ran: boolean;
  reason: string;
  rules: number;
  evaluated: number;
  promoted: string[];
}): TaskOutcome => ({
  status: r.ran ? "ok" : "skipped",
  summary: r.ran
    ? `${r.rules} rule(s) on ${r.evaluated} new report(s), activated ${r.promoted.join(", ") || "none"}`
    : r.reason,
});

/** Supervision and mining run as one job; a tripped breaker is what a person must see first. */
export const rulesOutcome = (r: {
  supervise: {
    ran: boolean;
    reason: string;
    breaker: { tripped: boolean; reasons: string[] };
    quarantined: string[];
  };
  mine: { ran: boolean; reason: string; proposed: number; passed: number; sandboxed: number };
}): TaskOutcome => {
  const { supervise: s, mine: m } = r;
  const sup = s.breaker.tripped
    ? `breaker TRIPPED (${s.breaker.reasons.join("; ")})`
    : s.ran
      ? `supervision ok, ${s.quarantined.length} quarantined`
      : `supervision skipped: ${s.reason}`;
  const mined = m.ran
    ? `${m.proposed} proposed, ${m.passed}/${m.sandboxed} passed sandbox`
    : `mining skipped: ${m.reason}`;
  return {
    status: s.breaker.tripped || s.quarantined.length ? "alert" : s.ran || m.ran ? "ok" : "skipped",
    summary: `${sup} · ${mined}`,
  };
};

async function start(task: string, trigger: TaskTrigger): Promise<number | undefined> {
  if (!dbConfigured()) return undefined;
  try {
    const sql = db();
    await sql`delete from task_runs where started_at < now() - make_interval(days => ${KEEP_DAYS})`;
    const [row] = await sql<{ id: string }[]>`
      insert into task_runs (task, trigger) values (${task}, ${trigger}) returning id`;
    return row ? Number(row.id) : undefined;
  } catch (e) {
    console.error(`[task-runs] could not record start of ${task}`, e);
    return undefined;
  }
}

async function finish(
  id: number | undefined,
  durationMs: number,
  status: TaskRunStatus,
  summary?: string,
  error?: string,
) {
  if (id === undefined) return;
  try {
    await db()`
      update task_runs
         set finished_at = now(), duration_ms = ${durationMs}, status = ${status},
             summary = ${summary?.slice(0, 500) ?? null}, error = ${error?.slice(0, 2000) ?? null}
       where id = ${id}`;
  } catch (e) {
    console.error("[task-runs] could not record finish", e);
  }
}

interface Row {
  task: string;
  trigger: TaskTrigger;
  started_at: Date;
  duration_ms: number | null;
  status: TaskRunStatus;
  summary: string | null;
  error: string | null;
}

function toRun(r: Row, now: number): TaskRun {
  const started = r.started_at.getTime();
  const status =
    r.status === "running" && now - started > INTERRUPTED_AFTER_MS ? "interrupted" : r.status;
  return {
    trigger: r.trigger,
    startedAt: r.started_at.toISOString(),
    status,
    ...(r.duration_ms !== null ? { durationMs: r.duration_ms } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Status of every scheduled job; recorded history is empty without a database. */
export async function listTaskStatus(now = new Date()): Promise<TaskStatus[]> {
  let rows: Row[] = [];
  if (dbConfigured()) {
    try {
      // The last 20 runs per job, plus the last 20 that did work: the sync is throttled, so
      // its recent history can be all skips while the runs that matter sit further back.
      rows = await db()<Row[]>`
        select task, trigger, started_at, duration_ms, status, summary, error from (
          select *, row_number() over (partition by task order by started_at desc) as n,
                    row_number() over (partition by task, status = 'skipped' order by started_at desc) as w
            from task_runs) r
         where n <= 20 or (w <= 20 and status <> 'skipped')
         order by started_at desc`;
    } catch (e) {
      console.error("[task-runs] could not read status", e);
    }
  }
  const t = now.getTime();
  return SCHEDULED_TASKS.map((task) => {
    const runs = rows.filter((r) => r.task === task.name).map((r) => toRun(r, t));
    const worked = runs.filter((r) => r.status !== "skipped" && r.status !== "running");
    const durations = worked
      .filter((r) => r.durationMs !== undefined && r.status !== "interrupted")
      .map((r) => r.durationMs!);
    const next = nextCronRun(task.cron, now);
    const typicalMs = median(durations);
    return {
      name: task.name,
      label: task.label,
      every: task.every,
      does: task.does,
      ...(next ? { nextRunAt: next.toISOString() } : {}),
      ...(runs[0] ? { last: runs[0] } : {}),
      ...(worked[0] ? { lastWorked: worked[0] } : {}),
      ...(typicalMs !== undefined ? { typicalMs } : {}),
      recentMs: durations.slice(0, 20).reverse(),
      recentFailures: runs
        .slice(0, 20)
        .filter((r) => r.status === "failed" || r.status === "interrupted").length,
    };
  });
}
