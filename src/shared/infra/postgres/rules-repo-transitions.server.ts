import type { RuleTransitions } from "@/shared/contracts/rules-repo";
import { db } from "./db.server";
import { json } from "./rules-repo-sql.server";

/** Status changes of dynamic_rules, each guarded by the status it may leave. */
export function createPostgresRuleTransitions(): RuleTransitions {
  return {
    async insertCandidate(rule) {
      // Re-proposing a rejected or quarantined pattern does not resurrect it; a human must.
      await db()`
    insert into dynamic_rules (id, kind, language, payload, status, origin, target_key, rationale, evidence, decided_by)
    values (${rule.id}, ${rule.kind}, ${rule.language}, ${json(rule.payload)}, 'candidate', ${rule.origin},
      ${rule.targetKey}, ${rule.rationale}, ${json(rule.evidence)}, ${rule.origin})
    on conflict (id) do nothing`;
    },

    async settleCandidate(id, next, shadowMetrics) {
      const [moved] = await db()`
    update dynamic_rules set status = ${next},
      shadow_metrics = ${next === "shadow" ? json(shadowMetrics) : null}
    where id = ${id} and status in ('candidate', 'evaluating', 'candidate_passed')
    returning status`;
      return !!moved;
    },

    async startShadow(id, shadowMetrics) {
      const rows = await db()`
    update dynamic_rules set status = 'shadow',
      shadow_metrics = ${json(shadowMetrics)}
    where id = ${id} and status = 'candidate_passed' returning id`;
      return rows.length > 0;
    },

    async rejectShadow(id) {
      const [r] = await db()`
        update dynamic_rules set status = 'rejected' where id = ${id} and status = 'shadow'
        returning id`;
      return !!r;
    },

    async activate(id, decidedBy) {
      await db()`
    update dynamic_rules set status = 'active', promoted_at = now(),
      decided_by = ${decidedBy}, version = version + 1
    where id = ${id}`;
    },

    async rejectOrQuarantine(id) {
      const rows = await db()`
    update dynamic_rules
    set status = case when status = 'active' then 'quarantined' else 'rejected' end,
      decided_by = 'analyst'
    where id = ${id} and status not in ('rejected', 'quarantined', 'superseded')
    returning status`;
      return (rows[0]?.["status"] as "rejected" | "quarantined" | undefined) ?? null;
    },

    async quarantineActive(id) {
      const [r] = await db()`
      update dynamic_rules set status = 'quarantined', decided_by = 'circuit_breaker'
      where id = ${id} and status = 'active' returning id`;
      return !!r;
    },

    async returnToShadow(id, shadowMetrics) {
      // The status change and its decision row commit together.
      return db().begin(async (tx) => {
        const [row] = await tx`
          update dynamic_rules set status = 'shadow', decided_by = 'autonomous_sandbox',
            shadow_metrics = ${json(shadowMetrics)}
          where id = ${id} and status = 'quarantined' returning id`;
        if (!row) return false;
        await tx`
          insert into rule_decisions (rule_id, category, origin, decision, actor, note)
          select id, kind || ':' || coalesce(target_key, '*'), origin, 'shadowed', 'autonomous',
            'probation after quarantine'
          from dynamic_rules where id = ${id}`;
        return true;
      });
    },

    async saveShadowMetrics(id, shadowMetrics) {
      await db()`update dynamic_rules set shadow_metrics = ${json(shadowMetrics)}
        where id = ${id}`;
    },

    async recordEvaluation(e) {
      await db()`
    insert into rule_evaluations (rule_id, passed, corpus_size, regressions, broken_fixtures, f1_delta, mode, rules_version, report)
    values (${e.ruleId}, ${e.passed}, ${e.corpusSize}, ${e.brokenFixtures.length},
      ${json(e.brokenFixtures)}, ${e.f1Delta}, ${e.mode}, ${e.rulesVersion}, ${json(e.report)})`;
    },
  };
}
