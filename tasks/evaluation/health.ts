import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { runEvaluationHealth } from "../../src/shared/infra/evaluation.server";

export default defineTask({
  meta: {
    name: "evaluation:health",
    description: "Run heuristic evaluation and alert on regressions",
  },
  async run() {
    await ensureMigrated();
    const res = await runEvaluationHealth();
    if (res.regression) {
      console.warn(`[evaluation:health] REGRESSION: ${res.details.join("; ")}`);
    } else {
      console.log(`[evaluation:health] OK: ${res.details.join("; ") || "no changes"}`);
    }
    return { result: res.reason };
  },
});
