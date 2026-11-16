import type { TaskRunRepo, TaskRunRow } from "@/shared/contracts/task-run-repo";
import { db } from "@/shared/infra/postgres/db.server";

interface Row {
  task: string;
  trigger: TaskRunRow["trigger"];
  started_at: Date;
  duration_ms: number | null;
  status: TaskRunRow["status"];
  summary: string | null;
  error: string | null;
}

/** PostgreSQL adapter for TaskRunRepo. */
export function createPostgresTaskRunRepo(): TaskRunRepo {
  return {
    async prune(days) {
      await db()`delete from task_runs where started_at < now() - make_interval(days => ${days})`;
    },

    async begin(task, trigger) {
      const [row] = await db()<{ id: string }[]>`
      insert into task_runs (task, trigger) values (${task}, ${trigger}) returning id`;
      return row ? Number(row.id) : undefined;
    },

    async finish(id, outcome) {
      await db()`
      update task_runs
         set finished_at = now(), duration_ms = ${outcome.durationMs}, status = ${outcome.status},
             summary = ${outcome.summary}, error = ${outcome.error}
       where id = ${id}`;
    },

    async recent() {
      const rows = await db()<Row[]>`
        select task, trigger, started_at, duration_ms, status, summary, error from (
          select *, row_number() over (partition by task order by started_at desc) as n,
                    row_number() over (partition by task, status = 'skipped' order by started_at desc) as w
            from task_runs) r
         where n <= 20 or (w <= 20 and status <> 'skipped')
         order by started_at desc`;
      return rows.map((r) => ({
        task: r.task,
        trigger: r.trigger,
        startedAt: r.started_at,
        durationMs: r.duration_ms,
        status: r.status,
        summary: r.summary,
        error: r.error,
      }));
    },
  };
}
