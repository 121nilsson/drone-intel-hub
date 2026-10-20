import { defineTask } from "nitro/task";
import { ensureMigrated } from "../../src/shared/infra/postgres/migrate.server";
import {
  mineAndSandbox,
  superviseActiveRules,
} from "../../src/shared/infra/evaluation/rule-sandbox.server";

export default defineTask({
  meta: {
    name: "evaluation:rules",
    description:
      "Supervise live rules (circuit breaker + audit), then mine and sandbox new hypotheses",
  },
  async run() {
    await ensureMigrated();
    // Supervision first: a rule quarantined tonight must not be the baseline new hypotheses
    // are sandboxed against.
    const sup = await superviseActiveRules();
    console.log(
      `[evaluation:rules] supervise ${sup.ran ? "ran" : "skipped"} - ${sup.reason}: breaker ${sup.breaker.tripped ? `TRIPPED (${sup.breaker.reasons.join("; ")})` : `ok over ${sup.breaker.checked} recent`}, ${sup.audited} audited, ${sup.quarantined.length} quarantined`,
    );
    const res = await mineAndSandbox();
    console.log(
      `[evaluation:rules] ${res.ran ? "ran" : "skipped"} - ${res.reason}: ${res.proposed} proposed, ${res.passed}/${res.sandboxed} passed sandbox, ${res.parserDefects} parser defects`,
    );
    return { result: `${sup.reason}; ${res.reason}` };
  },
});
