import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import {
  mineAndSandbox,
  startProbation,
  superviseActiveRules,
} from "../../src/shared/infra/evaluation/rule-sandbox.server";
import { recordTaskRun, rulesOutcome } from "../../src/shared/infra/task-runs.server";

export default defineTask({
  meta: {
    name: "evaluation:rules",
    description:
      "Supervise live rules (circuit breaker + audit), return due probation rules to shadow, then mine and sandbox new hypotheses",
  },
  async run() {
    await ensureMigrated();
    const {
      supervise: sup,
      probation,
      mine: res,
    } = await recordTaskRun(
      "evaluation:rules",
      "schedule",
      async () => {
        // Supervision first: a rule quarantined tonight must not be the baseline new hypotheses
        // are sandboxed against.
        const supervise = await superviseActiveRules();
        const probation = await startProbation();
        const mine = await mineAndSandbox();
        return { supervise, probation, mine };
      },
      rulesOutcome,
    );
    console.log(
      `[evaluation:rules] supervise ${sup.ran ? "ran" : "skipped"} - ${sup.reason}: breaker ${sup.breaker.tripped ? `TRIPPED (${sup.breaker.reasons.join("; ")})` : `ok over ${sup.breaker.checked} recent`}, ${sup.audited} audited, ${sup.quarantined.length} quarantined, ${probation.length} on probation`,
    );
    console.log(
      `[evaluation:rules] ${res.ran ? "ran" : "skipped"} - ${res.reason}: ${res.proposed} proposed, ${res.passed}/${res.sandboxed} passed sandbox, ${res.parserDefects} parser defects`,
    );
    return { result: `${sup.reason}; ${res.reason}` };
  },
});
