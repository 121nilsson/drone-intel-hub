import type { ProposalApplier, RiskTier } from "@/shared/contracts/proposals";
import { compileRuleSnapshot, type DynamicRuleRow, type RuleKind } from "@/shared/contracts/rules";

/**
 * Risk follows from what a rule can do to the catalogue (plan §4.5), never from the proposer.
 * An alias decides which system a passage is filed under and removing it does not re-file the
 * claims it carried; a stopword decides what is never a name. A unit scale stays on one claim.
 */
export const RULE_RISK: Record<RuleKind, RiskTier> = {
  add_unit_scale: "low",
  add_cue: "medium",
  context_filter: "medium",
  add_alias: "high",
  add_stopword: "high",
};

const isRuleKind = (k: string): k is RuleKind => Object.hasOwn(RULE_RISK, k);

/**
 * A `rule` proposal's target is "<rule kind>:<spec key or *>" (the category the autonomy loop
 * already scores trust under) and its payload is the dynamic rule's payload. It is well formed
 * when the engine's own compiler accepts it: the same literal-terms-only DSL, so a proposal
 * cannot carry anything the compiler would not.
 */
export const ruleApplier: ProposalApplier = {
  kind: "rule",
  check(draft) {
    const ruleKind = draft.target.split(":")[0] ?? "";
    if (!isRuleKind(ruleKind)) return { ok: false, reason: `unknown rule kind "${ruleKind}"` };
    const row: DynamicRuleRow = { id: "proposal", kind: ruleKind, payload: draft.payload };
    const snapshot = compileRuleSnapshot([row]);
    if (snapshot.invalid.length || snapshot.unsupported)
      return { ok: false, reason: `the rule compiler rejects this ${ruleKind} payload` };
    return { ok: true, risk: RULE_RISK[ruleKind] };
  },
};
