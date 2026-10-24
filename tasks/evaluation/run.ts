import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { runEvaluation } from "../../src/shared/infra/evaluation/evaluation.server";
import { ranOutcome, recordTaskRun } from "../../src/shared/infra/task-runs.server";

export default defineTask({
  meta: {
    name: "evaluation:run",
    description: "Run heuristic evaluation and store the report",
  },
  async run() {
    await ensureMigrated();
    const res = await recordTaskRun("evaluation:run", "schedule", runEvaluation, ranOutcome);
    console.log(`[evaluation:run] ${res.ran ? "ran" : "skipped"} - ${res.reason}`);
    return { result: res.reason };
  },
});
