import { defineTask } from "nitro/task";
import { mineAndSandbox } from "../../src/shared/infra/rule-sandbox.server";

export default defineTask({
  meta: {
    name: "evaluation:rules",
    description: "Mine rule hypotheses and sandbox them against the corpus (never activates)",
  },
  async run() {
    const res = await mineAndSandbox();
    console.log(
      `[evaluation:rules] ${res.ran ? "ran" : "skipped"} - ${res.reason}: ${res.proposed} proposed, ${res.passed}/${res.sandboxed} passed sandbox, ${res.parserDefects} parser defects`,
    );
    return { result: res.reason };
  },
});
