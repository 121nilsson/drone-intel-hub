export type TaskTrigger = "schedule" | "manual";
/** `alert`: the job ran fine and found something a person should look at (a health regression). */
export type TaskRunStatus = "running" | "ok" | "skipped" | "alert" | "failed" | "interrupted";

/** One stored run, as the table holds it. */
export interface TaskRunRow {
  task: string;
  trigger: TaskTrigger;
  startedAt: Date;
  durationMs: number | null;
  status: TaskRunStatus;
  summary: string | null;
  error: string | null;
}

/** How a run ended, already trimmed to the column limits. */
export interface TaskRunFinish {
  durationMs: number;
  status: TaskRunStatus;
  summary: string | null;
  error: string | null;
}

/** Port for the task-run log. Methods throw on a storage failure; callers log and carry on. */
export interface TaskRunRepo {
  /** Drop runs that started more than `days` days ago. */
  prune(days: number): Promise<void>;
  /** Record that a run started; the id is undefined when nothing was recorded. */
  begin(task: string, trigger: TaskTrigger): Promise<number | undefined>;
  /** Record how a started run ended. */
  finish(id: number, outcome: TaskRunFinish): Promise<void>;
  /**
   * The last 20 runs per job, plus the last 20 that did work: the sync is throttled, so its recent
   * history can be all skips while the runs that matter sit further back. Newest first.
   */
  recent(): Promise<TaskRunRow[]>;
}
