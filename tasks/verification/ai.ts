import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { dbConfigured } from "../../src/shared/infra/postgres/db.server";
import { runEntailment } from "../../src/shared/infra/verification/entailment.server";
import { entailmentOutcome, recordTaskRun } from "../../src/shared/infra/task-runs.server";

export default defineTask({
  meta: {
    name: "verification:ai",
    description: "Second reader: an independent model checks uncertain and audited claims",
  },
  async run() {
    if (!dbConfigured()) {
      console.log("[verification:ai] skipped - no database configured");
      return { result: "skipped: no database configured" };
    }
    await ensureMigrated();
    const r = await recordTaskRun("verification:ai", "schedule", runEntailment, entailmentOutcome);
    console.log(
      `[verification:ai] ${r.ran ? "ran" : "skipped"} - ${r.reason}: ${entailmentOutcome(r).summary}`,
    );
    return { result: r.reason };
  },
});
