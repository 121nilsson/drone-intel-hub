import { defineTask } from "nitro/task";
import { runAutoSync } from "../../src/shared/infra/source-sync.server";

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
    const res = await runAutoSync({ minIntervalMs: 9 * 60_000 });
    console.log(`[sources:sync] ${res.ran ? "ran" : "skipped"} - ${res.reason}`);
    return { result: res.reason };
  },
});
