import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { dbConfigured } from "../../src/shared/infra/postgres/db.server";
import { runServerVerification } from "../../src/shared/infra/verification/verify.server";
import { recordTaskRun } from "../../src/shared/infra/task-runs.server";

export default defineTask({
  meta: {
    name: "verification:run",
    description: "Deterministic claim verification over the whole archive",
  },
  async run() {
    // Without PostgreSQL the browser verifies its own store; this job has nothing to do, and is
    // a skip rather than an hourly failure.
    if (!dbConfigured()) {
      console.log("[verification:run] skipped - no database configured");
      return { result: "skipped: no database configured" };
    }
    await ensureMigrated();
    const r = await recordTaskRun("verification:run", "schedule", runServerVerification, (r) => ({
      status: "ok",
      summary: `${r.checked} checked, ${r.changed} updated, ${r.missingText} without post`,
    }));
    console.log(
      `[verification:run] ${r.checked} checked, ${r.changed} updated, ${r.missingText} without post`,
    );
    return { result: `${r.checked} checked, ${r.changed} updated` };
  },
});
