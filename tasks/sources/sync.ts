import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { runAutoSync } from "../../src/shared/infra/sources/source-sync.server";
import { ranOutcome, recordTaskRun } from "../../src/shared/infra/task-runs.server";

/**
 * Scheduled auto-ingest. Nitro drives this on the cron in vite.config.ts.
 *
 * The floor is enforced by the shared throttle in sync_state (a compare-and-swap claim), not
 * here, so the same guard protects the manual "Sync all now" button. It sits just under the
 * 10-minute cron period so a tick is never skipped by jitter, but a run (bounded to an 8-minute
 * AI window) cannot overlap the next one.
 */
export default defineTask({
  meta: {
    name: "sources:sync",
    description: "Poll monitored sources and ingest new drone reports",
  },
  async run() {
    await ensureMigrated();
    const res = await recordTaskRun(
      "sources:sync",
      "schedule",
      () => runAutoSync({ minIntervalMs: 9 * 60_000 }),
      ranOutcome,
    );
    console.log(`[sources:sync] ${res.ran ? "ran" : "skipped"} - ${res.reason}`);
    return { result: res.reason };
  },
});
