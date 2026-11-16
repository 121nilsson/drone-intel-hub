import type { RulesRepo } from "@/shared/contracts/rules-repo";
import { createPostgresRuleCandidatePool } from "./rules-repo-candidates.server";
import { createPostgresRuleDecisionLog } from "./rules-repo-decisions.server";
import { createPostgresRuleLock } from "./rules-repo-lock.server";
import { createPostgresRuleReader } from "./rules-repo-read.server";
import { createPostgresRuleTransitions } from "./rules-repo-transitions.server";

/** PostgreSQL adapter for RulesRepo: composes the role adapters, holds no SQL itself. */
export function createPostgresRulesRepo(): RulesRepo {
  return {
    ...createPostgresRuleReader(),
    ...createPostgresRuleDecisionLog(),
    ...createPostgresRuleTransitions(),
    ...createPostgresRuleCandidatePool(),
    ...createPostgresRuleLock(),
  };
}
