import { autonomySwitchEnabled } from "@/shared/infra/autonomy/switches.server";
import { recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";
import {
  newShadowMetrics,
  PROBATION_AFTER_DAYS,
  probationDue,
  ruleCategory,
  type DecisionActor,
  type DecisionKind,
  type ProbationDecision,
} from "@/shared/infra/evaluation/autonomy";
import {
  bumpRuleVersion,
  iso,
  rulesRepo,
  rulesSqlAvailable,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";

/**
 * Probation: a quarantined generated rule returns to shadow after a cooling-off period, so the
 * same shadow scoring and promotionVerdict as any new rule decide whether it is ever promoted
 * again. Nothing here activates a rule; a rule that is still bad fails the bar again.
 */
export async function startProbation(): Promise<string[]> {
  if (!autonomySwitchEnabled("rule_probation") || !rulesSqlAvailable()) return [];
  const now = new Date();
  const rules = await rulesRepo().quarantinedGenerated();
  if (!rules.length) return [];
  const ids = rules.map((r) => r.id);
  const history = await rulesRepo().decisionHistory(ids);
  const byRule = new Map<string, ProbationDecision[]>();
  for (const h of history) {
    byRule.set(h.ruleId, [
      ...(byRule.get(h.ruleId) ?? []),
      {
        decision: h.decision as DecisionKind,
        actor: h.actor as DecisionActor,
        decidedAt: iso(h.decidedAt) ?? "",
      },
    ]);
  }
  const started: string[] = [];
  for (const r of rules) {
    const id = r.id;
    const kind = r.kind;
    const targetKey = r.targetKey;
    const rule = { kind, origin: r.origin, status: r.status };
    if (!probationDue(rule, byRule.get(id) ?? [], now)) continue;
    try {
      // The repository commits the status change and its decision row together. The version
      // bump reads the database to refresh the rule snapshot, so it runs after the commit.
      const moved = await rulesRepo().returnToShadow(id, newShadowMetrics(now.toISOString()));
      if (!moved) continue;
      await bumpRuleVersion(`probation ${id}`);
      await recordAutonomyEvent({
        action: "rule_probation_started",
        actor: "rule-sandbox:probation",
        actorKind: "system",
        targetCollection: "dynamic_rules",
        targetId: id,
        category: ruleCategory(kind, targetKey),
        before: { status: "quarantined" },
        after: { status: "shadow" },
        reason: `probation after ${PROBATION_AFTER_DAYS} days in quarantine: back to shadow to earn promotion again`,
        reversible: true,
      });
      started.push(id);
    } catch (e) {
      // One rule's failure must not stop the others, nor the mining step that follows.
      console.error("[evaluation:rules] probation failed for", id, e);
    }
  }
  return started;
}
