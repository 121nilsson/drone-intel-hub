import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
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
import { bumpRuleVersion, iso, json } from "@/shared/infra/evaluation/rule-sandbox-store.server";

/**
 * Probation: a quarantined generated rule returns to shadow after a cooling-off period, so the
 * same shadow scoring and promotionVerdict as any new rule decide whether it is ever promoted
 * again. Nothing here activates a rule; a rule that is still bad fails the bar again.
 */
export async function startProbation(): Promise<string[]> {
  if (!autonomySwitchEnabled("rule_probation") || !dbConfigured()) return [];
  const now = new Date();
  const rules = await db()`
    select id, kind, target_key, status, origin from dynamic_rules
    where status = 'quarantined' and origin = 'autonomous_sandbox'`;
  if (!rules.length) return [];
  const ids = rules.map((r) => r["id"] as string);
  const history = await db()`
    select rule_id, decision, actor, decided_at from rule_decisions where rule_id = any(${ids})`;
  const byRule = new Map<string, ProbationDecision[]>();
  for (const h of history) {
    const id = h["rule_id"] as string;
    byRule.set(id, [
      ...(byRule.get(id) ?? []),
      {
        decision: h["decision"] as DecisionKind,
        actor: h["actor"] as DecisionActor,
        decidedAt: iso(h["decided_at"]) ?? "",
      },
    ]);
  }
  const started: string[] = [];
  for (const r of rules) {
    const id = r["id"] as string;
    const kind = r["kind"] as string;
    const targetKey = (r["target_key"] as string | null) ?? null;
    const rule = { kind, origin: r["origin"] as string, status: r["status"] as string };
    if (!probationDue(rule, byRule.get(id) ?? [], now)) continue;
    try {
      // The status change and its decision row commit together. The version bump reads the
      // database to refresh the rule snapshot, so it runs after the commit, not inside it.
      const moved = await db().begin(async (tx) => {
        const [row] = await tx`
          update dynamic_rules set status = 'shadow', decided_by = 'autonomous_sandbox',
            shadow_metrics = ${json(newShadowMetrics(now.toISOString()))}
          where id = ${id} and status = 'quarantined' returning id`;
        if (!row) return false;
        await tx`
          insert into rule_decisions (rule_id, category, origin, decision, actor, note)
          select id, kind || ':' || coalesce(target_key, '*'), origin, 'shadowed', 'autonomous',
            'probation after quarantine'
          from dynamic_rules where id = ${id}`;
        return true;
      });
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
