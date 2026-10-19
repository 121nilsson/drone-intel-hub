import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { runShadow } from "../../src/shared/infra/rule-sandbox.server";

export default defineTask({
  meta: {
    name: "evaluation:shadow",
    description: "Score shadow rules on newly ingested reports and auto-promote earned ones",
  },
  async run() {
    await ensureMigrated();
    const res = await runShadow();
    console.log(
      `[evaluation:shadow] ${res.ran ? "ran" : "skipped"} - ${res.reason}: ${res.rules} rule(s), ${res.evaluated} new report(s), promoted ${res.promoted.join(", ") || "none"}`,
    );
    return { result: res.reason };
  },
});
