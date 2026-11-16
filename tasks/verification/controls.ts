import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import { serverServices } from "../../src/shared/infra/server-services.server";
import { runVerifierControls } from "../../src/shared/infra/verification/controls.server";
import { controlsOutcome, recordTaskRun } from "../../src/shared/infra/task-runs.server";

export default defineTask({
  meta: {
    name: "verification:controls",
    description: "Verifier controls: the second reader is shown claims wrong by construction",
  },
  async run() {
    if (!serverServices().backend.capabilities.sql) {
      console.log("[verification:controls] skipped - no database configured");
      return { result: "skipped: no database configured" };
    }
    await ensureMigrated();
    const r = await recordTaskRun(
      "verification:controls",
      "schedule",
      runVerifierControls,
      controlsOutcome,
    );
    console.log(
      `[verification:controls] ${r.ran ? "ran" : "skipped"} - ${r.reason}: ${controlsOutcome(r).summary}`,
    );
    return { result: r.reason };
  },
});
