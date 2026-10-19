import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { runEvaluation } from "../../src/shared/infra/evaluation.server";

export default defineTask({
  meta: {
    name: "evaluation:run",
    description: "Run heuristic evaluation and store the report",
  },
  async run() {
    await ensureMigrated();
    const res = await runEvaluation();
    console.log(`[evaluation:run] ${res.ran ? "ran" : "skipped"} - ${res.reason}`);
    return { result: res.reason };
  },
});
