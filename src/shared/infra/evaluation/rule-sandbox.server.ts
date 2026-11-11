/**
 * This file is a barrel: the rule sandbox is split by concern into the rule-sandbox-*.server.ts
 * modules beside it, and importers keep using this path.
 */

/**
 * Rule lifecycle on the server (EVALUATION_FULL_AUTOMATION §4):
 *
 *   candidate → sandbox → candidate_passed (analyst rule) | shadow (generated rule) | rejected
 *   shadow → active (analyst click, or auto-promotion once trust is earned) → quarantined
 *
 * Activation always re-runs the sandbox against the rules active at that moment, so a verdict
 * computed before another rule went live can never let a regression through. Every transition
 * is logged in rule_decisions, which is what trust is calibrated from.
 */

export type { Json, RuleView, ProposeInput } from "./rule-sandbox-types.server";
export { proposeRule } from "./rule-sandbox-propose.server";
export { sandboxRule } from "./rule-sandbox-sandbox.server";
export { activateRule } from "./rule-sandbox-activation.server";
export { shadowRule, rejectRule } from "./rule-sandbox-lifecycle.server";
export { replayRule, type ReplayResult } from "./rule-sandbox-replay.server";
export { listRules } from "./rule-sandbox-list.server";
export { mineAndSandbox, type MineRunResult } from "./rule-sandbox-mine.server";
export { getAutonomyStatus, type AutonomyStatus } from "./rule-sandbox-autonomy.server";
export { runShadow, type ShadowRunResult } from "./rule-sandbox-shadow.server";
export { superviseActiveRules, type SuperviseResult } from "./rule-sandbox-supervise.server";
export { startProbation } from "./rule-sandbox-probation.server";
