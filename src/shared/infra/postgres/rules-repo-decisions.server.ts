import type { RuleDecisionLog } from "@/shared/contracts/rules-repo";
import { db } from "./db.server";

/** rule_decisions (what trust is calibrated from) and the dynamic_rules_version counter. */
export function createPostgresRuleDecisionLog(): RuleDecisionLog {
  return {
    async recordDecision(id, decision, actor, note = null) {
      await db()`
    insert into rule_decisions (rule_id, category, origin, decision, actor, note)
    select id, kind || ':' || coalesce(target_key, '*'), origin, ${decision}, ${actor}, ${note}
    from dynamic_rules where id = ${id}`;
    },

    async appendVersion(note) {
      await db()`insert into dynamic_rules_version (version, note)
    select coalesce(max(version), 0) + 1, ${note} from dynamic_rules_version`;
    },

    async decisions() {
      const rows = await db()`select category, origin, decision, actor from rule_decisions`;
      return rows.map((r) => ({
        category: r["category"] as string,
        origin: r["origin"] as string,
        decision: r["decision"] as string,
        actor: r["actor"] as string,
      }));
    },

    async autoActivatedLast24h() {
      const [c] = await db()`
    select count(*)::int as n from rule_decisions
    where decision = 'auto_activated' and decided_at > now() - interval '24 hours'`;
      return Number(c?.["n"] ?? 0);
    },

    async recentDecisions() {
      const rows = await db()`
    select rule_id, decision, actor, note, decided_at from rule_decisions
    order by decided_at desc limit 20`;
      return rows.map((r) => ({
        ruleId: r["rule_id"] as string,
        decision: r["decision"] as string,
        actor: r["actor"] as string,
        note: (r["note"] as string | null) ?? null,
        decidedAt: r["decided_at"],
      }));
    },

    async decisionHistory(ruleIds) {
      const ids = [...ruleIds];
      const rows = await db()`
    select rule_id, decision, actor, decided_at from rule_decisions where rule_id = any(${ids})`;
      return rows.map((h) => ({
        ruleId: h["rule_id"] as string,
        decision: h["decision"] as string,
        actor: h["actor"] as string,
        decidedAt: h["decided_at"],
      }));
    },
  };
}
