import { defineTask } from "nitro/task";
import { runEvaluation } from "../../src/shared/infra/evaluation.server";

export default defineTask({
  meta: {
    name: "evaluation:run",
    description: "Run heuristic evaluation and store the report",
  },
  async run() {
    const res = await runEvaluation();
    console.log(`[evaluation:run] ${res.ran ? "ran" : "skipped"} - ${res.reason}`);
    return { result: res.reason };
  },
});
