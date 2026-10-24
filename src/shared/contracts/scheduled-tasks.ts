/**
 * The background jobs and when they run. One list: vite.config.ts builds Nitro's schedule from
 * it, and the evaluation page shows each job's status from it, so the two cannot disagree.
 * Cron fields are minute, hour, day of month, month, day of week, in the server's clock (UTC in
 * the container).
 */
export interface ScheduledTask {
  name: string;
  cron: string;
  label: string;
  /** When it runs, in words. */
  every: string;
  does: string;
}

export const SCHEDULED_TASKS: readonly ScheduledTask[] = [
  {
    name: "sources:sync",
    cron: "*/10 * * * *",
    label: "Source sync",
    every: "every 10 min",
    does: "Polls the monitored sources and ingests new reports. A run stops starting AI work after 8 min, so ticks never overlap.",
  },
  {
    name: "evaluation:shadow",
    cron: "35 * * * *",
    label: "Shadow scoring",
    every: "hourly at :35",
    does: "Scores shadow rules on newly ingested reports, and auto-activates the ones that meet the bar (unless RULES_AUTOPROMOTE=off).",
  },
  {
    name: "evaluation:run",
    cron: "15 3 * * *",
    label: "Heuristic evaluation",
    every: "daily 03:15",
    does: "Evaluates the heuristic on a sample and saves the report behind the trend charts.",
  },
  {
    name: "evaluation:health",
    cron: "45 3 * * *",
    label: "Health check",
    every: "daily 03:45",
    does: "Compares the latest evaluation with earlier ones and raises an alert on a regression.",
  },
  {
    name: "evaluation:rules",
    cron: "15 4 * * *",
    label: "Rule supervision and mining",
    every: "daily 04:15",
    does: "Circuit breaker over recently activated rules, then mines new rule hypotheses and sandboxes them.",
  },
];
